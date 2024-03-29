# WARDuino VS Code Debugger Plugin

This directory contains the source code for the VS Code plugin for the WARDuino debugger.

## Features


## Requirements


## Extension Settings

The debugger contributes the following settings:

## Testing

To run the vm tests run:

```bash
env WABT='path to wabt commands' npm run test-vm
```

To run the spec tests with Latch:

```bash
env WABT='dir with WABT commands' CORESUITE='dir with original spec test suite' npm run spectest
```

## Development Notes

Before first time use make sure you have:

- Installed VS Code (version 1.63.2 or higher)
- Installed [this WebAssembly Plugin](https://github.com/AlanCezarAraujo/vscode-webassembly-syntax-highlight)
- Enabled the `Debug: Allow Breakpoints Everywhere` setting
- Install `node` and `yarn`
- Install [WARDuino](https://github.com/TOPLLab/WARDuino)

To run the extension in developer mode, perform the following steps:

- (optional) Compile the WARDuino CLI (Emulator version) in this directory
  - create `WARDuino/platforms/Arduino-socket/.config` with the content
    ```
    SSID=NetworkName
    PASSWORD=NetworkPass
    ```
- Run `install.sh`: this builds the dependencies like our [the custom WABT](https://github.com/TOPLLab/wabt).
- Add add both `wat2wasm` and `wasm-objdump` to your `$PATH`
    ```
    export PATH=$(realpath WABT/build/):$PATH
    ```

When you have performed each step above. You should be able to open this directory in VS Code and run the extension.
When you run `Run Extension` a new VS Code instance should start.
In order to launch the debugger in this new VS Code window, perform the following steps:

- open a directory with a WAT file (example folder in this repo: src/test/UnitTests/TestSource/)
- Go to the settings of VS Code and fill in all the WARDuino debugger settings
- add a `.vscode/launch.json` file with the same content as the launch file in the example folder: `src/test/UnitTests/TestSource/.vscode/launch.json` (you can skip this step if you opened the example folder)
- start the debugger with the `Debug WARDuino` button

## Known Issues


