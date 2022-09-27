import * as vscode from 'vscode';
import {WASMCompilerBridge} from '../../CompilerBridges/WASMCompilerBridge';

// Tests specific to the extension
describe('Extension Test Suite', () => {

    vscode.window.showInformationMessage('Start all tests.');

    it('Test WASM Compiler Bridge', () => {
        let compilerBridge = new WASMCompilerBridge("", "", "");
        compilerBridge.compile();
    });
});
