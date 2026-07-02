#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <emscripten/emscripten.h>

#include "./system.hpp"

using namespace emscripten;

EMSCRIPTEN_BINDINGS(Module)
{
    class_<System>("System")
        .constructor()
        .function("configure", &System::configure)
        .function("reset", &System::reset)
        .function("findCameraPoseWithIMU", &System::findCameraPoseWithIMU, allow_raw_pointers())
        .function("findCameraPose", &System::findCameraPose, allow_raw_pointers())
        .function("findPlane", &System::findPlane, allow_raw_pointers())
        .function("getFramePoints", &System::getFramePoints, allow_raw_pointers())
        .function("getMapPoints3D", &System::getMapPoints3D, allow_raw_pointers())
        .function("findPlaneAt", &System::findPlaneAt, allow_raw_pointers())
        .function("findPlaneFromPoints", &System::findPlaneFromPoints, allow_raw_pointers())
        .function("createAnchor", &System::createAnchor, allow_raw_pointers())
        .function("getAnchorPose", &System::getAnchorPose, allow_raw_pointers())
        .function("removeAnchor", &System::removeAnchor)
        .function("clearAnchors", &System::clearAnchors);
}
