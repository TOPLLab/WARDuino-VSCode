import * as vscode from 'vscode';
import { ProviderResult, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { RuntimeState } from '../State/RuntimeState';
import { DebugBridge } from '../DebugBridges/DebugBridge';
import { RuntimeViewRefreshInterface } from './RuntimeViewRefreshInterface';
import { getLineNumberForAddress } from '../State/SourceMap';

export enum AllowedAction {
    Save = 'save',
    DebugExternally = 'debug-externally',
    None = 'none'
}

export class DebuggingTimelineProvider implements vscode.TreeDataProvider<TimelineItem>, RuntimeViewRefreshInterface {

    private _onDidChangeTreeData: vscode.EventEmitter<TimelineItem | undefined | null | void> = new vscode.EventEmitter<TimelineItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TimelineItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private debugBridge: DebugBridge;
    private items: TimelineItem[];
    private itemsBeingSaved: Set<number>;
    private view?: vscode.TreeView<TreeItem>;

    constructor(debugBridge: DebugBridge) {
        this.debugBridge = debugBridge;
        this.items = [];
        this.itemsBeingSaved = new Set();
        this.view = undefined;
    }

    getParent(item: TreeItem) {
        return undefined;
    }

    setView(view: vscode.TreeView<TreeItem>) {
        this.view = view;
    }

    getChildren(element?: TimelineItem): ProviderResult<TimelineItem[]> {
        if (element === undefined && !!this.view) {
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
                const sm = this.debugBridge.getSourceMap();
                const doNotMinusOne = false;
                const linenr = getLineNumberForAddress(sm, rs.getProgramCounter(), doNotMinusOne);
                let label = '';
                if (linenr !== undefined) {
                    label = `Line ${linenr}`;
                }
                return new TimelineItem(label, rs, this.debugBridge, idx, act, this.view!);
            });
            const activeIndex = timeline.getIndexOfActiveState();
            if (activeIndex !== undefined) {
                this.items[activeIndex].select();
            }

            this.items = this.items.reverse();
            return this.items;
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

    getSelected(): undefined | TimelineItem {
        return this.items.find(item => item.isSelected());
    }

    getItemFromTimeLineIndex(index: number): TimelineItem | undefined {
        return this.items.find(i => i.getTimelineIndex() === index);
    }
}

export class TimelineItem extends vscode.TreeItem {
    private runtimeState: RuntimeState;
    private debuggerBridge: DebugBridge;
    private timelineIndex: number;
    private selected: boolean;
    private allowedAction: AllowedAction;
    private view: vscode.TreeView<TreeItem>;

    constructor(
        sessionlabel: string,
        runtimeState: RuntimeState,
        debuggerBridge: DebugBridge,
        timelineIndex: number,
        allowedAction: AllowedAction,
        view: vscode.TreeView<TreeItem>,
        treeItemCollapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None
    ) {
        super(`Session#${timelineIndex} ${sessionlabel}`, treeItemCollapsibleState);
        this.runtimeState = runtimeState;
        this.debuggerBridge = debuggerBridge;
        this.timelineIndex = timelineIndex;
        this.selected = false;
        this.allowedAction = allowedAction;
        this.contextValue = allowedAction;
        this.view = view;
        if (runtimeState.hasException()) {
            this.iconPath = new vscode.ThemeIcon('bug');
        }
    }

    public select() {
        this.selected = true;
        if (this.view) {
            this.view.reveal(this);
        }
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