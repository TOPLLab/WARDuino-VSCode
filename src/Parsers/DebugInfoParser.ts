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

    public parse(bridge: DebugBridge, message: Uint8Array): boolean {
        // Parse message
        let notification: Notification = Notification.decode(Reader.create(message));
        console.debug(`parsing: checking if message is well-formed... ${notification !== null ? "yes" : "no"}`);
        console.debug(`parsing: checking type of message... ${notification.type}`);

        // Send parsed message to debug bridge
        console.debug(`parsing: resolving...`);
        switch (notification.type) {
            case Notification_Type.continued:  // nothing to do
            case Notification_Type.halted:
            // TODO handle halted debugger backend
            case Notification_Type.paused:
                break;
            case Notification_Type.stepped:
                bridge.refresh();
                break;
            case Notification_Type.hitbreakpoint:
                let breakpointInfo = notification.payload?.breakpoint;
                if (breakpointInfo !== undefined && breakpointInfo.length > 1
                    && !isNaN(parseInt(breakpointInfo))) {
                    bridge.hitBreakpoint(parseInt(breakpointInfo));  // TODO test
                } else {
                    console.error(`parsing: unrecognized breakpoint`);
                    return false;
                }
                break;
            case Notification_Type.newevent:
                bridge.notifyNewEvent();
                break;
            case Notification_Type.changeaffected:
                bridge.refresh();
                break;
            case Notification_Type.dump:
                const snapshot = notification.payload?.snapshot;
                if (snapshot !== undefined) {
                    const runtimeState: RuntimeState = this.parseSnapshot(bridge, message.toString(), snapshot);
                    bridge.updateRuntimeState(runtimeState);
                    console.debug(bridge.getProgramCounter().toString(16));
                } else {
                    console.error(`parsing: dump contains no snapshot payload`);
                    return false;
                }
                break;
            case Notification_Type.dumplocals:
                // TODO update locals
                break;
            case Notification_Type.snapshot:
                // TODO send snapshot to new debugger backend (start EDWARD)
                break;
            case Notification_Type.dumpevents:
                bridge.refreshEvents(notification.payload?.queue?.events.map((obj: Event) => (new EventItem(obj.topic, obj.payload))) ?? []);
                break;
            case Notification_Type.dumpcallbacks:
                // TODO update callbacks with payload
                break;
            case Notification_Type.malformed:
                console.error(`parsing: debugger backend reports malformed debug message`);
                return false;
            case Notification_Type.unknown:
                console.error(`parsing: debugger backend reports debug message with unknown debug type`);
                return false;
            case Notification_Type.UNRECOGNIZED:
                console.log(`parsing: unrecognized type of notification`);
                return false;
            default:
                console.error(`parsing: notification is of unhand-able type`);
                return false;
        }
        return true;
    }

    private parseSnapshot(bridge: DebugBridge, id: string, snapshot: Snapshot): RuntimeState {
        const runtimeState: RuntimeState = new RuntimeState(id);
        runtimeState.programCounter = snapshot?.programCounter ?? 0;
        runtimeState.callstack = snapshot?.callstack.filter(entry => entry.type === 0).map(entry => ({
            index: entry.fidx,
            returnAddress: entry.ra
        } as Frame)) ?? [];
        runtimeState.locals = this.parseLocals(runtimeState.currentFunction(), bridge, snapshot?.locals?.values ?? []);
        runtimeState.events = snapshot?.queue?.events.map((e: Event) => (new EventItem(e.topic, e.payload))) ?? [];
        return runtimeState;
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
        console.debug(locals);
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
