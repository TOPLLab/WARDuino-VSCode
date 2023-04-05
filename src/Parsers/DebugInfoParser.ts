import { DebugBridge } from "../DebugBridges/DebugBridge";
import { EventItem } from "../Views/EventsProvider";
import { RuntimeState } from "../State/RuntimeState";
import { SourceMap } from "../State/SourceMap";
import { BreakpointPolicy } from "../State/Breakpoint";

export class DebugInfoParser {

    private sourceMap: SourceMap;

    constructor(sourceMap: SourceMap) {
        this.sourceMap = sourceMap;
    }

    public updateSourceMap(sourceMap: SourceMap) {
        this.sourceMap = sourceMap;
    }

    public parse(bridge: DebugBridge, line: any): void {
        if (line.includes("STEP")) {
            bridge.refresh();
        }

        if (line.includes("AT")) {
            let breakpointInfo = line.match(/AT ([0-9]+)!/);
            if (breakpointInfo.length > 1) {
                let pc = parseInt(breakpointInfo[1]);
                bridge.pause();
                if (bridge.getBreakpointPolicy() === BreakpointPolicy.singleStop) {
                    bridge.getListener().notifyInfoMessage(`Enforcing '${BreakpointPolicy.singleStop}' breakpoint policy`);
                    bridge.unsetAllBreakpoints();
                    bridge.run();
                } else if (bridge.getBreakpointPolicy() === BreakpointPolicy.removeAndProceed) {
                    bridge.getListener().notifyInfoMessage(`Enforcing '${BreakpointPolicy.removeAndProceed}' breakpoint policy`);
                    bridge.unsetBreakPoint(pc);
                    bridge.run();
                }
            }
        }

        if (line.includes("new pushed event")) {
            bridge.notifyNewEvent();
        }

        if (line.startsWith("{\"events")) {
            // TODO create empty runtimeState
            const rs = bridge.getCurrentState();
            const evts = JSON.parse(line).events;
            if (!!rs && !!evts) {
                rs.setEvents(evts.map((obj: EventItem) => (new EventItem(obj.topic, obj.payload))));
                bridge?.refreshViews();
            } else {
                if (!!!rs) {
                    console.error("DebugInfoParser: no runtimestate to set events upon");
                }
                if (!!!evts) {
                    console.log("DebugInfoParser: received invalid events");
                }
            }
        } else if (line.startsWith("{\"pc")) {
            const runtimeState: RuntimeState = new RuntimeState(line, this.sourceMap);
            bridge.updateRuntimeState(runtimeState);
            const currentState = bridge.getCurrentState();
            console.log(`PC=${currentState!.getProgramCounter()} (Hexa ${currentState!.getProgramCounter().toString(16)})`);
        }
        else if (line.startsWith("{\"")) {
            // request to missing state
            const state = bridge.getCurrentState();
            if (!!!state) {
                return;
            }
            const missingState = new RuntimeState(line, this.sourceMap);
            state.copyMissingState(missingState);
            bridge.refreshViews();
            console.log(`PC=${state!.getProgramCounter()} (Hexa ${state!.getProgramCounter().toString(16)})`);
        }
    }
}
