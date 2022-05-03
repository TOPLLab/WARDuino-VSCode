# install script - for use during development only

echo "> Plugin: fetching submodules"
git submodule update --init

echo "> WARDuino: fetching submodules"
cd WARDuino
git fetch
git checkout feat/wood
git submodule update --init

echo "> WARDuino: building emulator"
mkdir -p build-emu
cd build-emu
cmake .. -D BUILD_EMULATOR=ON
make
cd ../..

echo "> WABT: fetching submodules"
cd WABT
git submodule update --init

echo "> WABT: building tools"
mkdir build
cd build
cmake ..
make

