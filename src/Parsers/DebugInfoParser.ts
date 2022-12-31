import {DebugBridge} from "../DebugBridges/DebugBridge";
import {VariableInfo} from "../State/VariableInfo";
import {Frame} from "./Frame";
import {EventItem} from "../Views/EventsProvider";
import {RuntimeState} from "../State/RuntimeState";

export class DebugInfoParser {

    private addressBeginning: number = 0;

    public parse(bridge: DebugBridge, line: any): void {
        if (line.includes("STEP")) {
            bridge.refresh();
        }

        if (line.includes("AT")) {
            let breakpointInfo = line.match(/AT ([0-9]+)!/);
            if (breakpointInfo.length > 1) {
                let pc = parseInt(breakpointInfo[1]);
                bridge.setProgramCounter(pc);
                bridge.pause();
            }
        }

        if (line.includes("new pushed event")) {
            bridge.notifyNewEvent();
        }

        if (line.startsWith("{\"events")) {
            bridge.refreshEvents(JSON.parse(line).events?.map((obj: EventItem) => (new EventItem(obj.topic, obj.payload))));
        } else if (line.startsWith("{\"pc")) {
            const parsed = JSON.parse(line);
            const runtimeState: RuntimeState = new RuntimeState(line);
            runtimeState.startAddress = parseInt(parsed.start);
            runtimeState.setRawProgramCounter(parseInt(parsed.pc));
            runtimeState.callstack = this.parseCallstack(parsed.callstack);
            runtimeState.locals = this.parseLocals(runtimeState.currentFunction(), bridge, parsed.locals.locals);
            runtimeState.events = parsed.events?.map((obj: EventItem) => (new EventItem(obj.topic, obj.payload)));

            bridge.updateRuntimeState(runtimeState);
            console.log(bridge.getProgramCounter().toString(16));
        }
    }

    private parseLocals(fidx: number, bridge: DebugBridge, objs: any[]): VariableInfo[] {
        let locals: VariableInfo[] = bridge.getLocals(fidx);
        objs.forEach((obj) => {
            let local = locals[obj.index];
            if (local) {
                local.type = obj.type;
                local.value = obj.value;
            }
        });
        console.log(locals);
        return locals;
    }

    private parseCallstack(objs: any[]): Frame[] {
        let functions: Frame[] = [];
        objs.filter((obj) => {
            return obj.type === 0;
        }).forEach((obj) => {
            functions.push({index: parseInt(obj.fidx), returnAddress: parseInt(obj.callsite) - this.addressBeginning});
        });
        return functions;
    }
}
