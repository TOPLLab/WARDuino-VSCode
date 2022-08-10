import {DebugBridge} from "../DebugBridges/DebugBridge";
import {VariableInfo} from "../State/VariableInfo";
import {Frame} from "./Frame";
import {EventItem} from "../Views/EventsProvider";
import {RuntimeState} from "../State/RuntimeState";
import {Event, Notification, Notification_Type, Snapshot} from "./debug";
import {TextEncoder} from "util";
import {Reader} from "protobufjs/minimal";

export class DebugInfoParser {

    private addressBeginning: number = 0;

    public parse(bridge: DebugBridge, line: string): void {
        console.debug(`parsing: received message of length... ${line.length}`);
        let bin: Uint8Array = new TextEncoder().encode(line);
        console.debug(`parsing: encoding input... ${bin !== null ? "succeeded" : "failed"}`);
        let message: Notification = Notification.decode(Reader.create(bin));
        console.debug(`parsing: checking if message is well-formed... ${message !== null ? "yes" : "no"}`);
        console.debug(`parsing: checking type of message... ${message.type}`);

        console.debug(`parsing: resolving...`);
        switch (message.type) {
            case Notification_Type.continued:  // nothing to do
            case Notification_Type.halted:
                // TODO handle halted debugger backend
            case Notification_Type.paused:
                break;
            case Notification_Type.stepped:
                bridge.refresh();
                break;
            case Notification_Type.hitbreakpoint:
                let breakpointInfo = message.payload?.breakpoint;
                if (breakpointInfo !== undefined && breakpointInfo.length > 1) {
                    let pc = parseInt(breakpointInfo);  // TODO test
                    bridge.setProgramCounter(pc);
                    bridge.pause();
                } else {
                    console.error(`parsing: unrecognized breakpoint`);
                }
                break;
            case Notification_Type.newevent:
                bridge.notifyNewEvent();
                break;
            case Notification_Type.changeaffected:
                bridge.refresh();
                break;
            case Notification_Type.dump:
                const runtimeState: RuntimeState = new RuntimeState(line);
                // TODO bridge.updateRuntimeState(runtimeState);
                break;
            case Notification_Type.dumplocals:
                // TODO update locals
                break;
            case Notification_Type.snapshot:
                // TODO send snapshot to new debugger backend (start EDWARD)
                break;
            case Notification_Type.dumpevents:
                bridge.refreshEvents(message.payload?.queue?.events.map((obj: Event) => (new EventItem(obj.topic, obj.payload))) ?? []);
                break;
            case Notification_Type.dumpcallbacks:
                // TODO update callbacks with payload
                break;
            case Notification_Type.malformed:
                console.error(`parsing: debugger backend reports malformed debug message`);
                break;
            case Notification_Type.unknown:
                console.error(`parsing: debugger backend reports debug message with unknown debug type`);
                break;
            case Notification_Type.UNRECOGNIZED:
                console.log(`parsing: unrecognized type of notification`);
                break;
            default:
                console.error(`parsing: notification is of unhand-able type`);
                break;
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
