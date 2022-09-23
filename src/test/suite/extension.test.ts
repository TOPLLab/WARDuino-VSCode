import * as vscode from 'vscode';
import {WASMCompilerBridge} from '../../CompilerBridges/WASMCompilerBridge';

// Tests specific to the extension
suite('Extension Test Suite', () => {

    vscode.window.showInformationMessage('Start all tests.');

    test('Test WASM Compiler Bridge', () => {
        let compilerBridge = new WASMCompilerBridge("", "", "");
        compilerBridge.compile();
    });
});
