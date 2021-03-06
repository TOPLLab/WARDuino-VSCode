import * as vscode from 'vscode';
import {ErrorReporter} from './DebugSession/ErrorReporter';
import {InlineDebugAdapterFactory} from './DebugSession/InlineDebugAdapterFactory';

export function activate(context: vscode.ExtensionContext) {
    let status = installStatusMenuBar(context);
    let errorReporter = installDiagnosticReporting(context);
    let factory = new InlineDebugAdapterFactory(status, errorReporter);
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('WARDuinoDBG', factory));
    context.subscriptions.push(vscode.commands.registerCommand('warduinodebug.upload', () => {
        factory.warduino?.upload();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('warduinodebug.multiverse', () => {
        factory.warduino?.startMultiverseDebugging();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('warduinodebug.popEvent', () => {
        factory.warduino?.popEvent();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('warduinodebug.toggleCallback', resource => {
        factory.warduino?.toggleProxy(resource);
    }));
}

function installDiagnosticReporting(context: vscode.ExtensionContext) {
    return new ErrorReporter(context);
}

function installStatusMenuBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
    let warduinoStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
    initialiseStatusBarItem(warduinoStatusBarItem);
    context.subscriptions.push(warduinoStatusBarItem);
    return warduinoStatusBarItem;
}

function initialiseStatusBarItem(warduinoStatusBarItem: vscode.StatusBarItem) {
    warduinoStatusBarItem.tooltip = "Information about the status of the WARDuino debugger";
    warduinoStatusBarItem.text = "Plugin loaded";
    warduinoStatusBarItem.show();
}

export function deactivate() {
    console.log("Deactivated ... ");
}
