import { RuntimeState } from "../State/RuntimeState";
import { RuntimeViewRefreshInterface } from "./RuntimeViewRefreshInterface";

export class RuntimeViewsRefresher {

    private viewsProviders: RuntimeViewRefreshInterface[];

    constructor() {
        this.viewsProviders = []
    }


    addViewProvider(viewProvider: RuntimeViewRefreshInterface) {
        this.viewsProviders.push(viewProvider);
    }

    refreshViews(runtimeState: RuntimeState) {
        this.viewsProviders.forEach(v => {
            v.refreshView(runtimeState);
        });
    }

}