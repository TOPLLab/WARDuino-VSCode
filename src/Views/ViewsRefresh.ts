import * as vscode from 'vscode';

import { DeviceConfig } from '../DebuggerConfig';
import { RuntimeState } from '../State/RuntimeState';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';

export class RuntimeViewsRefresher {

    private viewsProviders: RuntimeViewRefreshInterface[];
    private extensionName: string;

    constructor(extensionName: string) {
        this.viewsProviders = [];
        this.extensionName = extensionName;
    }


    addViewProvider(viewProvider: RuntimeViewRefreshInterface) {
        this.viewsProviders.push(viewProvider);
    }

    refreshViews(runtimeState?: RuntimeState) {
        this.viewsProviders.forEach(v => {
            v.refreshView(runtimeState);
        });
    }

    showViewsFromConfig(deviceConfig: DeviceConfig) {
        const showBreakPointPolicies = deviceConfig.isBreakpointPolicyEnabled();
        vscode.commands.executeCommand('setContext', `${this.extensionName}.showBreakpointPolicies`, showBreakPointPolicies);
    }

}