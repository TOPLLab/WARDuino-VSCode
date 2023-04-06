import * as vscode from 'vscode';
import { ProviderResult, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { RuntimeState } from '../State/RuntimeState';
import { DebugBridge } from '../DebugBridges/DebugBridge';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';

export enum AllowedAction {
    Save = "save",
    DebugExternally = "debug-externally",
    None = "none"
}

export class DebuggingTimelineProvider implements vscode.TreeDataProvider<TimelineItem>, RuntimeViewRefreshInterface {

    private _onDidChangeTreeData: vscode.EventEmitter<TimelineItem | undefined | null | void> = new vscode.EventEmitter<TimelineItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TimelineItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private debugBridge: DebugBridge;
    private items: TimelineItem[];
    private itemsBeingSaved: Set<number>;

    constructor(debugBridge: DebugBridge) {
        this.debugBridge = debugBridge;
        this.items = [];
        this.itemsBeingSaved = new Set();
    }

    getChildren(element?: TimelineItem): ProviderResult<TimelineItem[]> {
        if (element === undefined) {
            const timeline = this.debugBridge.getDebuggingTimeline();
            const states = timeline.getRuntimesChronologically();
            this.items = states.map((rs: RuntimeState, idx: number) => {
                let act = AllowedAction.None;
                if (rs.hasAllState()) {
                    act = AllowedAction.DebugExternally;
                }
                else if ((idx === states.length - 1) && !this.itemsBeingSaved.has(idx)) {
                    act = AllowedAction.Save;
                }
                return new TimelineItem(rs, this.debugBridge, idx, act);
            });
            this.items = this.items.reverse();
            const activeIndex = timeline.getIndexOfActiveState();
            if (!!activeIndex) {
                this.items[activeIndex].select();
            }

            return this.items;
        } else if (element.collapsibleState !== TreeItemCollapsibleState.None) {
            return undefined;
        }
        return undefined;
    }

    getTreeItem(element: TimelineItem): TreeItem | Thenable<TreeItem> {
        return element;
    }

    setDebugBridge(debugBridge: DebugBridge) {
        this.debugBridge = debugBridge;
    }

    refreshView(runtimeState?: RuntimeState) {
        this._onDidChangeTreeData.fire();
    }

    showItemAsBeingSaved(item: TimelineItem) {
        this.itemsBeingSaved.add(item.getTimelineIndex());
    }

    showItem(item: TimelineItem) {
        this.items.forEach(i => {
            if (item !== i) {
                i.deSelect();
            }
            else {
                item.select();
            }
        });
    }

    getSelected(): undefined | TimelineItem {
        return this.items.find(item => item.isSelected());
    }
}

export class TimelineItem extends vscode.TreeItem {
    private runtimeState: RuntimeState;
    private debuggerBridge: DebugBridge;
    private timelineIndex: number;
    private selected: boolean;
    private allowedAction: AllowedAction;

    constructor(runtimeState: RuntimeState, debuggerBridge: DebugBridge, timelineIndex: number, allowedAction: AllowedAction, treeItemCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
        super(`Session#${timelineIndex} ${runtimeState.getId()}`, treeItemCollapsibleState);
        this.runtimeState = runtimeState;
        this.debuggerBridge = debuggerBridge;
        this.timelineIndex = timelineIndex;
        this.selected = false;
        this.allowedAction = allowedAction;
        this.contextValue = allowedAction;
    }

    public select() {
        this.selected = true;
    }

    public deSelect() {
        this.selected = false;
    }

    public toggle() {
        this.selected = !this.selected;
    }

    public isSelected() {
        return this.selected;
    }

    public getTimelineIndex() {
        return this.timelineIndex;
    }

    public getDebuggerBridge() {
        return this.debuggerBridge;
    }

    public getRuntimeState() {
        return this.runtimeState;
    }
}