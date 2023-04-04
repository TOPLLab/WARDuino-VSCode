import { RuntimeState } from "../State/RuntimeState";

export interface RuntimeViewRefreshInterface {

    refreshView(runtimeState: RuntimeState): void;

}