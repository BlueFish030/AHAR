#!/bin/bash
set -euo pipefail

# The lib directory
LIB_ROOT=$PWD

# Emscripten path: EMSDK env (CI/WSL), or legacy local install
if [ -n "${EMSDK:-}" ] && [ -d "${EMSDK}/upstream/emscripten" ]; then
  EMSCRIPTEN_DIR="${EMSDK}/upstream/emscripten"
elif [ -n "${EMSCRIPTEN:-}" ] && [ -d "${EMSCRIPTEN}" ]; then
  EMSCRIPTEN_DIR="${EMSCRIPTEN}"
else
  EMSCRIPTEN_DIR="${HOME}/Development/emsdk/upstream/emscripten"
fi

if [ ! -d "$EMSCRIPTEN_DIR" ]; then
  echo "Emscripten not found at: $EMSCRIPTEN_DIR"
  echo "Set EMSDK or EMSCRIPTEN, or install emsdk."
  exit 1
fi

# Emscripten cmake
EMSCRIPTEN_CMAKE_DIR=$EMSCRIPTEN_DIR/cmake/Modules/Platform/Emscripten.cmake

# Sets the compile flags. [SIMD, THREADS, DEFAULT]
BUILD_TYPE="DEFAULT"

if [ $BUILD_TYPE = "SIMD" ]; then
  echo "Compiling with SIMD enabled"
  INSTALL_DIR=$LIB_ROOT/build_simd/
  BUILD_FLAGS="-O3 -std=c++17 -msimd128";
  CONF_OPENCV="--simd";
elif [ $BUILD_TYPE = "THREADS" ]; then
  echo "Compiling with THREADS enabled"
  INSTALL_DIR=$LIB_ROOT/build_threads/
  BUILD_FLAGS="-O3 -std=c++17 -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4";
  CONF_OPENCV="--threads";
else
  echo "Compiling with DEFAULT settings"
  INSTALL_DIR=$LIB_ROOT/build/
  BUILD_FLAGS="-O3 -std=c++17";
  CONF_OPENCV="";
fi

build_OPENCV() {
  # To enable opencv_contrib-4.x modules add the following line to opencv/platforms/js/build_js.py -> def get_cmake_cmd(self):
  # "-DOPENCV_EXTRA_MODULES_PATH=[YOUR_PATH_TO_OPENCV_CONTRIB_DIR]/opencv_contrib-4.x/modules",
  # For more options look here: https://docs.opencv.org/4.x/d4/da1/tutorial_js_setup.html

  rm -rf $INSTALL_DIR/opencv/

  python3 "$LIB_ROOT/opencv/platforms/js/build_js.py" "$INSTALL_DIR/opencv" --build_wasm $CONF_OPENCV --emscripten_dir "$EMSCRIPTEN_DIR"

  # WASM build tree has static libs in lib/ but no installed OpenCVConfig.cmake
  write_opencv_config
}

write_opencv_config() {
  local cv_build="$INSTALL_DIR/opencv"
  local cv_src="$LIB_ROOT/opencv"
  local cv_lib="$cv_build/lib"

  if [ ! -f "$cv_lib/libopencv_core.a" ]; then
    echo "OpenCV static libs missing — building module archives"
    (cd "$cv_build" && emmake make -j \
      opencv_core opencv_imgproc opencv_features2d opencv_flann \
      opencv_calib3d opencv_objdetect opencv_video)
  fi

  test -f "$cv_lib/libopencv_core.a" || {
    echo "ERROR: $cv_lib/libopencv_core.a not found after OpenCV WASM build"
    exit 1
  }

  cat > "$cv_build/OpenCVConfig.cmake" << EOF
set(OpenCV_FOUND TRUE)
set(OpenCV_VERSION "4.5.5")
set(OpenCV_INSTALL_PATH "${cv_build}")
set(OpenCV_LIB_DIR "${cv_lib}")
set(OpenCV_INCLUDE_DIRS
  "${cv_build}"
  "${cv_src}/include"
  "${cv_src}/modules/core/include"
  "${cv_src}/modules/imgproc/include"
  "${cv_src}/modules/features2d/include"
  "${cv_src}/modules/flann/include"
  "${cv_src}/modules/calib3d/include"
  "${cv_src}/modules/objdetect/include"
  "${cv_src}/modules/video/include"
)
set(OpenCV_LIBS opencv_core opencv_imgproc opencv_features2d opencv_flann opencv_calib3d opencv_objdetect opencv_video)
set(OpenCV_LIBRARIES "")
foreach(_lib \${OpenCV_LIBS})
  list(APPEND OpenCV_LIBRARIES "\${OpenCV_LIB_DIR}/lib\${_lib}.a")
endforeach()
EOF

  echo "Wrote OpenCVConfig.cmake -> $cv_build/OpenCVConfig.cmake"
}

build_EIGEN() {
  # Header-only: vendored Eigen is missing scripts/buildtests.in required by cmake.
  echo "Installing Eigen (header-only)"
  rm -rf $INSTALL_DIR/eigen/
  rm -rf $LIB_ROOT/eigen/build
  mkdir -p "$INSTALL_DIR/eigen/include/eigen3"
  cp -r "$LIB_ROOT/eigen/Eigen" "$INSTALL_DIR/eigen/include/eigen3/"
  if [ -d "$LIB_ROOT/eigen/unsupported" ]; then
    cp -r "$LIB_ROOT/eigen/unsupported" "$INSTALL_DIR/eigen/include/eigen3/"
  fi

  mkdir -p "$INSTALL_DIR/eigen/share/eigen3/cmake"
  cat > "$INSTALL_DIR/eigen/share/eigen3/cmake/Eigen3Config.cmake" << 'EOF'
if(NOT TARGET Eigen3::Eigen)
  add_library(Eigen3::Eigen INTERFACE IMPORTED)
  set_target_properties(Eigen3::Eigen PROPERTIES
    INTERFACE_INCLUDE_DIRECTORIES "${CMAKE_CURRENT_LIST_DIR}/../../../include/eigen3")
endif()
set(EIGEN3_INCLUDE_DIR "${CMAKE_CURRENT_LIST_DIR}/../../../include/eigen3")
set(EIGEN3_FOUND TRUE)
EOF

  mkdir -p "$LIB_ROOT/eigen/build"
  cp "$INSTALL_DIR/eigen/share/eigen3/cmake/Eigen3Config.cmake" "$LIB_ROOT/eigen/build/Eigen3Config.cmake"
}

build_OBINDEX2() {
  if [ -f "$INSTALL_DIR/opencv/lib/libopencv_core.a" ] && [ ! -f "$INSTALL_DIR/opencv/OpenCVConfig.cmake" ]; then
    write_opencv_config
  fi

  rm -rf $INSTALL_DIR/obindex2/
  rm -rf $LIB_ROOT/obindex2/build
  mkdir -p $LIB_ROOT/obindex2/build

  cd $LIB_ROOT/obindex2/build
  emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_STANDARD=17 \
    -DCMAKE_TOOLCHAIN_FILE=$EMSCRIPTEN_CMAKE_DIR \
    -DCMAKE_CXX_FLAGS="${BUILD_FLAGS} -s USE_BOOST_HEADERS=1" \
    -DCMAKE_C_FLAGS="${BUILD_FLAGS} -s USE_BOOST_HEADERS=1" \
    -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR/obindex2/ \
    -DBUILD_SHARED_LIBS=OFF \
    -DOpenCV_DIR=$INSTALL_DIR/opencv \
    -DEnableTesting=OFF
  emmake make -j install
}

build_IBOW_LCD(){
  rm -rf $INSTALL_DIR/ibow_lcd/
  rm -rf $LIB_ROOT/ibow_lcd/build
  mkdir -p $LIB_ROOT/ibow_lcd/build

  cd $LIB_ROOT/ibow_lcd/build
  emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_STANDARD=17 \
    -DCMAKE_TOOLCHAIN_FILE=$EMSCRIPTEN_CMAKE_DIR \
    -DCMAKE_CXX_FLAGS="${BUILD_FLAGS} -s USE_BOOST_HEADERS=1" \
    -DCMAKE_C_FLAGS="${BUILD_FLAGS} -s USE_BOOST_HEADERS=1" \
    -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR/ibow_lcd/ \
    -DBUILD_SHARED_LIBS=OFF \
    -DOpenCV_DIR=$INSTALL_DIR/opencv
  emmake make -j install
}

build_SOPHUS(){
  rm -rf $INSTALL_DIR/Sophus/
  rm -rf $LIB_ROOT/Sophus/build
  mkdir -p $LIB_ROOT/Sophus/build

  cd $LIB_ROOT/Sophus/build
  emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_STANDARD=17 \
    -DCMAKE_TOOLCHAIN_FILE=$EMSCRIPTEN_CMAKE_DIR \
    -DCMAKE_CXX_FLAGS="${BUILD_FLAGS}" \
    -DCMAKE_C_FLAGS="${BUILD_FLAGS}" \
    -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR/Sophus/ \
    -DBUILD_SHARED_LIBS=OFF \
    -DEIGEN3_INCLUDE_DIR=$LIB_ROOT/eigen/
  emmake make -j install
}

build_CERES(){
  # When done compiling a string replace is called on all files in ceres-solver/install/include
  # to replace "glog/logging.h" with "ceres/internal/miniglog/glog/logging.h"

  rm -rf $INSTALL_DIR/ceres-solver/
  rm -rf $LIB_ROOT/ceres-solver/build
  mkdir -p $LIB_ROOT/ceres-solver/build

  cd $LIB_ROOT/ceres-solver/build
  emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_STANDARD=17 \
    -DCMAKE_TOOLCHAIN_FILE=$EMSCRIPTEN_CMAKE_DIR \
    -DCMAKE_CXX_FLAGS="${BUILD_FLAGS}" \
    -DCMAKE_C_FLAGS="${BUILD_FLAGS}" \
    -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR/ceres-solver/ \
    -DBUILD_SHARED_LIBS=OFF \
    -DBUILD_EXAMPLES:BOOL=0 \
    -DBUILD_TESTING:BOOL=0 \
    -DEIGENSPARSE:BOOL=1 \
    -DCERES_THREADING_MODEL="NO_THREADS" \
    -DMINIGLOG:BOOL=1 \
    -DEigen3_DIR=$INSTALL_DIR/eigen/share/eigen3/cmake/
  emmake make -j install
  find $INSTALL_DIR/ceres-solver/include -type f -name '*.h' -exec sed -i.bak 's#glog/logging.h#ceres/internal/miniglog/glog/logging.h#g' {} +
  find $INSTALL_DIR/ceres-solver/include -type f -name '*.bak' -delete
}

build_OPENGV(){
  rm -rf $INSTALL_DIR/opengv/
  rm -rf $LIB_ROOT/opengv/build
  mkdir -p $LIB_ROOT/opengv/build

  cd $LIB_ROOT/opengv/build
  emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_STANDARD=17 \
    -DCMAKE_TOOLCHAIN_FILE=$EMSCRIPTEN_CMAKE_DIR \
    -DCMAKE_CXX_FLAGS="${BUILD_FLAGS}" \
    -DCMAKE_C_FLAGS="${BUILD_FLAGS}" \
    -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR/opengv/ \
    -DBUILD_SHARED_LIBS=OFF \
    -DEIGEN_INCLUDE_DIR=$LIB_ROOT/eigen/
  emmake make -j install
}

build() {
    array=($@)
    length=${#array[@]}

    BL='\033[1;34m'
    NC='\033[0m'

    for (( i=0; i<length; i++ ));
    do
      echo -e "${BL}Step $(($i+1))/$length -------------------------------- Start building: ${array[$i]} ${NC}"
      build_${array[$i]}
      echo -e "${BL}Step $(($i+1))/$length -------------------------------- Complete ${NC}\n\n"
    done
}

libsToBuild=( "EIGEN" "OPENCV" "OBINDEX2" "IBOW_LCD" "SOPHUS" "CERES" "OPENGV" )

# Standalone: bash build.sh opencv-config
if [ "${1:-}" = "opencv-config" ]; then
  write_opencv_config
  exit 0
fi

build ${libsToBuild[@]}