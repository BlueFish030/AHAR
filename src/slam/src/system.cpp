#include "system.hpp"
#include <memory>
#include <iostream>
#include <algorithm>
#include <cmath>

System::System()
{
}

System::~System()
{
}

void System::configure(int imageWidth, int imageHeight, double fx, double fy, double cx, double cy, double k1, double k2, double p1, double p2)
{
    state_ = std::make_shared<State>(imageWidth, imageHeight, 40);
    state_->claheEnabled_ = false;
    state_->mapKeyframeFilteringRatio_ = 0.95;
    state_->p3pEnabled_ = true;

    std::cout << "- [System]: Configure";
    std::cout << ": width: " << state_->imgWidth_;
    std::cout << ", height: " << state_->imgHeight_;
    std::cout << ", Frame Max Cell Size: " << state_->frameMaxCellSize_;
    std::cout << ", CLAHE Enabled: " << state_->claheEnabled_;
    std::cout << ", Map Keyframe Filtering Ratio: " << state_->mapKeyframeFilteringRatio_;
    std::cout << ", P3P Enabled: " << state_->p3pEnabled_ << std::endl;

    cameraCalibration_ = std::make_shared<CameraCalibration>(fx, fy, cx, cy, k1, k2, p1, p2, imageWidth, imageHeight, 20);

    currFrame_ = std::make_shared<Frame>(cameraCalibration_, state_->frameMaxCellSize_);

    featureExtractor_ = std::make_shared<FeatureExtractor>(state_->extractorMaxQuality_);
    featureTracker_ = std::make_shared<FeatureTracker>(state_->trackerMaxIterations_, state_->trackerMaxPxPrecision_);

    mapManager_ = std::make_shared<MapManager>(state_, currFrame_, featureExtractor_);
    mapper_ = std::make_shared<Mapper>(state_, mapManager_, currFrame_);

    visualFrontend_ = std::make_unique<VisualFrontend>(state_, currFrame_, mapManager_, mapper_, featureTracker_);
}

void System::reset()
{
    std::cout << "- [System]: Reset" << std::endl;

    clearAnchors();
    cachedMapPoints_.clear();

    currFrame_->reset();
    visualFrontend_->reset();
    mapManager_->reset();
    state_->reset();
}

int System::findCameraPoseWithIMU(int imageRGBADataPtr, int imuDataPtr, int posePtr)
{
    auto *imageData = reinterpret_cast<uint8_t *>(imageRGBADataPtr);
    auto *imuData = reinterpret_cast<double *>(imuDataPtr);
    auto *poseData = reinterpret_cast<float *>(posePtr);

    cv::Mat image = cv::Mat(state_->imgHeight_, state_->imgWidth_, CV_8UC4, imageData);
    cv::cvtColor(image, image, cv::COLOR_RGBA2GRAY);

    //quaternion format: wxyz. -x to mirror slam format
    Eigen::Quaterniond orientation(imuData[0], -imuData[1], imuData[2], imuData[3]);
    Eigen::Matrix3d qwc = orientation.toRotationMatrix().inverse();
    Eigen::Vector3d twc(0.0, 0.0, 0.0);
    Sophus::SE3d Twc(qwc, twc);

    int motionSampleSize = 7;
    int motionSampleNum = (int) imuData[4] * motionSampleSize;

    for (int i = 5; i < motionSampleNum; i += motionSampleSize)
    {
        // { timestamp, gx, gy, gz, ax, ay, az }
        auto timestamp = (uint64_t) imuData[i];
        Eigen::Vector3d gyr(imuData[i + 1], imuData[i + 2], imuData[i + 3]);
        Eigen::Vector3d acc(imuData[i + 4], imuData[i + 5], imuData[i + 6]);
    }

    uint64_t timestamp = duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();

    int status = processCameraPose(image, timestamp);

    if( status == 1 )
    {
        Twc.translation() = currFrame_->getTwc().translation();
    }

    Utils::toPoseArray(Twc, poseData);

    return 1;
}

int System::findCameraPose(int imageRGBADataPtr, int posePtr)
{
    auto *imageData = reinterpret_cast<uint8_t *>(imageRGBADataPtr);
    auto *poseData = reinterpret_cast<float *>(posePtr);

    cv::Mat image = cv::Mat(state_->imgHeight_, state_->imgWidth_, CV_8UC4, imageData);
    cv::cvtColor(image, image, cv::COLOR_RGBA2GRAY);

    uint64_t timestamp = duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();

    int status = processCameraPose(image, timestamp);

    Utils::toPoseArray(currFrame_->getTwc(), poseData);

    return status;
}

int System::findPlane(int locationPtr, int numIterations)
{
    cv::Mat mat = processPlane(mapManager_->getCurrentFrameMapPoints(), currFrame_->getTwc(), numIterations, true);

    if (mat.empty())
    {
        return 0;
    }

    auto *poseData = reinterpret_cast<float *>(locationPtr);

    Utils::toPoseArray(mat, poseData);

    return 1;
}

int System::getMapPoints3D(int pointsPtr, int maxPoints)
{
    cachedMapPoints_ = mapManager_->getCurrentFrameMapPoints();

    const int count = std::min(static_cast<int>(cachedMapPoints_.size()), maxPoints);
    auto *data = reinterpret_cast<float *>(pointsPtr);

    for (int i = 0; i < count; ++i)
    {
        data[i * 3 + 0] = static_cast<float>(cachedMapPoints_[i].x());
        data[i * 3 + 1] = static_cast<float>(cachedMapPoints_[i].y());
        data[i * 3 + 2] = static_cast<float>(cachedMapPoints_[i].z());
    }

    return count;
}

std::vector<Eigen::Vector3d> System::selectMapPointsNearRay(int screenX, int screenY, int maxPoints)
{
    const auto mapPoints = mapManager_->getCurrentFrameMapPoints();

    if (mapPoints.empty())
    {
        return {};
    }

    const double fx = cameraCalibration_->fx_;
    const double fy = cameraCalibration_->fy_;
    const double cx = cameraCalibration_->cx_;
    const double cy = cameraCalibration_->cy_;

    Eigen::Vector3d rayCam((screenX - cx) / fx, (screenY - cy) / fy, 1.0);
    rayCam.normalize();

    const Sophus::SE3d Twc = currFrame_->getTwc();
    const Eigen::Vector3d rayOrigin = Twc.translation();
    const Eigen::Vector3d rayDir = Twc.rotationMatrix() * rayCam;

    std::vector<std::pair<double, int>> distances;
    distances.reserve(mapPoints.size());

    for (int i = 0; i < static_cast<int>(mapPoints.size()); ++i)
    {
        const Eigen::Vector3d diff = mapPoints[i] - rayOrigin;
        const double dist = diff.cross(rayDir).norm();
        distances.emplace_back(dist, i);
    }

    std::sort(distances.begin(), distances.end(), [](const auto &a, const auto &b)
    {
        return a.first < b.first;
    });

    const int pickCount = std::min(maxPoints, static_cast<int>(distances.size()));
    std::vector<Eigen::Vector3d> subset;
    subset.reserve(pickCount);

    for (int i = 0; i < pickCount; ++i)
    {
        subset.push_back(mapPoints[distances[i].second]);
    }

    return subset;
}

int System::findPlaneAt(int screenX, int screenY, int posePtr, int numIterations)
{
    const auto subset = selectMapPointsNearRay(screenX, screenY, 32);

    if (subset.size() < 3)
    {
        return 0;
    }

    cv::Mat mat = processPlane(subset, currFrame_->getTwc(), numIterations, false);

    if (mat.empty())
    {
        return 0;
    }

    auto *poseData = reinterpret_cast<float *>(posePtr);
    Utils::toPoseArray(mat, poseData);

    return 1;
}

int System::findPlaneFromPoints(int indicesPtr, int count, int posePtr, int numIterations)
{
    if (count < 3)
    {
        return 0;
    }

    if (cachedMapPoints_.empty())
    {
        cachedMapPoints_ = mapManager_->getCurrentFrameMapPoints();
    }

    if (cachedMapPoints_.empty())
    {
        return 0;
    }

    const auto *indices = reinterpret_cast<const int *>(indicesPtr);
    std::vector<Eigen::Vector3d> subset;
    subset.reserve(count);

    for (int i = 0; i < count; ++i)
    {
        const int idx = indices[i];

        if (idx < 0 || idx >= static_cast<int>(cachedMapPoints_.size()))
        {
            return 0;
        }

        subset.push_back(cachedMapPoints_[idx]);
    }

    cv::Mat mat = processPlane(subset, currFrame_->getTwc(), numIterations, false);

    if (mat.empty())
    {
        return 0;
    }

    auto *poseData = reinterpret_cast<float *>(posePtr);
    Utils::toPoseArray(mat, poseData);

    return 1;
}

int System::createAnchor(int posePtr, int anchorId)
{
    const auto *poseData = reinterpret_cast<const float *>(posePtr);

    cv::Mat pose(4, 4, CV_32F);
    for (int row = 0; row < 4; ++row)
    {
        for (int col = 0; col < 4; ++col)
        {
            pose.at<float>(row, col) = poseData[col * 4 + row];
        }
    }

    anchors_[anchorId] = pose;

    return 1;
}

int System::getAnchorPose(int anchorId, int posePtr)
{
    const auto it = anchors_.find(anchorId);

    if (it == anchors_.end())
    {
        return 0;
    }

    auto *poseData = reinterpret_cast<float *>(posePtr);
    Utils::toPoseArray(it->second, poseData);

    return 1;
}

int System::removeAnchor(int anchorId)
{
    return anchors_.erase(anchorId) > 0 ? 1 : 0;
}

void System::clearAnchors()
{
    anchors_.clear();
}

int System::getFramePoints(int pointsPtr)
{
    auto *data = reinterpret_cast<int *>(pointsPtr);

    int numPoints = currFrame_->getKeypoints2d().size();
    int n = std::min(numPoints * 2, 4096);

    for (int i = 0, j = 0; i < n; ++i)
    {
        cv::Point2f p = currFrame_->getKeypoints2d()[i].unpx_;
        data[j++] = (int) p.x;
        data[j++] = (int) p.y;
    }

    return numPoints;
}

int System::processCameraPose(cv::Mat &image, double timestamp)
{
    currFrame_->id_++;
    currFrame_->timestamp_ = timestamp;

    visualFrontend_->track(image, timestamp);

    if (state_->slamResetRequested_)
    {
        reset();
        return 2;
    }

    if (!state_->slamReadyForInit_)
    {
        return 3;
    }

    return 1;
}

cv::Mat System::processPlane(std::vector<Eigen::Vector3d> mapPoints, Sophus::SE3d Twc, int numIterations, bool requireHorizontal)
{
    cv::Mat planePose;

    const long numMapPoints = mapPoints.size();

    if (numMapPoints < 16)
    {
        std::cout << "- [System]: Too few points to detect plane: " << numMapPoints << std::endl;

        return planePose;
    }

    std::vector<cv::Mat> points(numMapPoints);
    std::vector<int> indices(numMapPoints);
    std::vector<float> distances;
    float bestDist = 1e10;

    for (int i = 0; i < numMapPoints; i++)
    {
        cv::Mat pointWorldPos(1, 3, CV_32F);
        cv::eigen2cv(mapPoints[i], pointWorldPos);
        points[i] = pointWorldPos;
        indices[i] = i;
    }

    //RANSAC to find inliers
    for (int n = 0; n < numIterations; n++)
    {
        // Pick 3 random points
        int numToPick = 3;
        std::vector<int> indicesPicked;
        std::sample(indices.begin(), indices.end(), std::back_inserter(indicesPicked), numToPick, std::mt19937{std::random_device{}()});

        cv::Mat u, w, vt;
        cv::Mat A(3, 4, CV_32F);
        A.col(3) = cv::Mat::ones(3, 1, CV_32F);

        for (int i = 0; i < numToPick; i++)
        {
            A.row(i).colRange(0, 3) = points[indicesPicked[i]].t();
        }

        cv::SVDecomp(A, w, u, vt, cv::SVD::MODIFY_A | cv::SVD::FULL_UV);

        const float a = vt.at<float>(3, 0);
        const float b = vt.at<float>(3, 1);
        const float c = vt.at<float>(3, 2);
        const float d = vt.at<float>(3, 3);

        std::vector<float> dists(numMapPoints, 0);

        const float f = 1.0f / std::sqrt(a * a + b * b + c * c + d * d);

        for (int i = 0; i < numMapPoints; i++)
        {
            dists[i] = std::fabs(points[i].at<float>(0) * a + points[i].at<float>(1) * b + points[i].at<float>(2) * c + d) * f;
        }

        std::vector<float> distsSorted = dists;
        sort(distsSorted.begin(), distsSorted.end());

        int nth = std::max((int) (0.2 * numMapPoints), 20);
        const float medianDist = distsSorted[nth];

        if (medianDist < bestDist)
        {
            bestDist = medianDist;
            distances = dists;
        }
    }

    // Compute threshold inlier/outlier
    const float threshold = 1.4 * bestDist;
    std::vector<cv::Mat> pointsInliers;

    for (int i = 0; i < numMapPoints; i++)
    {
        if (distances[i] < threshold)
        {
            pointsInliers.push_back(points[i]);
        }
    }

    // convert cam pos from Eigen to CV Mat format
    cv::Mat camPose(4, 4, CV_32F);
    Utils::toPoseMat(Twc, camPose);

    // arbitrary orientation along normal
    float rang = -3.14f / 2 + ((float) rand() / (float) RAND_MAX) * 3.14f;

    const long numInliers = pointsInliers.size();

    // recompute plane with all pointsInliers
    cv::Mat A = cv::Mat(numInliers, 4, CV_32F);
    A.col(3) = cv::Mat::ones(numInliers, 1, CV_32F);

    cv::Mat origin = cv::Mat::zeros(3, 1, CV_32F);

    for (int i = 0; i < numInliers; i++)
    {
        cv::Mat Xw = pointsInliers[i];
        origin += Xw;
        A.row(i).colRange(0, 3) = Xw.t();
    }

    A.resize(numInliers);

    cv::Mat u, w, vt;
    cv::SVDecomp(A, w, u, vt, cv::SVD::MODIFY_A | cv::SVD::FULL_UV);

    float a = vt.at<float>(3, 0);
    float b = vt.at<float>(3, 1);
    float c = vt.at<float>(3, 2);

    origin = origin * (1.0f / numInliers);
    const float f = 1.0f / sqrt(a * a + b * b + c * c);

    cv::Mat Oc = -camPose.colRange(0, 3).rowRange(0, 3).t() * camPose.rowRange(0, 3).col(3);
    cv::Mat mXC = Oc - origin;

    if ((mXC.at<float>(0) * a + mXC.at<float>(1) * b + mXC.at<float>(2) * c) > 0)
    {
        a = -a;
        b = -b;
        c = -c;
    }

    const float nx = a * f;
    const float ny = b * f;
    const float nz = c * f;

    cv::Mat normal = (cv::Mat_<float>(3, 1) << nx, ny, nz);

    if (requireHorizontal && std::fabs(ny) < 0.7f)
    {
        std::cout << "- [System]: Plane rejected (not horizontal): ny=" << ny << std::endl;
        return planePose;
    }

    planePose = cv::Mat::eye(4, 4, CV_32F);

    if (requireHorizontal)
    {
        cv::Mat up = (cv::Mat_<float>(3, 1) << 0.0f, 1.0f, 0.0f);
        cv::Mat v = up.cross(normal);
        const float sa = cv::norm(v);
        const float ca = up.dot(normal);
        const float ang = atan2(sa, ca);

        planePose.rowRange(0, 3).colRange(0, 3) = Utils::expSO3(v * ang / sa) * Utils::expSO3(up * rang);
    }
    else
    {
        cv::Mat yAxis = normal / cv::norm(normal);
        cv::Mat ref = (std::fabs(yAxis.at<float>(1)) < 0.9f)
            ? (cv::Mat_<float>(3, 1) << 0.0f, 1.0f, 0.0f)
            : (cv::Mat_<float>(3, 1) << 1.0f, 0.0f, 0.0f);
        cv::Mat xAxis = ref.cross(yAxis);
        xAxis = xAxis / cv::norm(xAxis);
        cv::Mat zAxis = xAxis.cross(yAxis);
        zAxis = zAxis / cv::norm(zAxis);

        cv::Mat rot(3, 3, CV_32F);
        xAxis.copyTo(rot.col(0));
        yAxis.copyTo(rot.col(1));
        zAxis.copyTo(rot.col(2));
        rot.copyTo(planePose.rowRange(0, 3).colRange(0, 3));
    }

    origin.copyTo(planePose.col(3).rowRange(0, 3));

    return planePose;
}
