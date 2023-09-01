export const CONFIG =
{
    // the adapter implements the configurationDone request.
    supportsConfigurationDoneRequest: true,

    // make VS Code use 'evaluate' when hovering over source
    supportsEvaluateForHovers: false,

    // make VS Code show a 'step back' button
    supportsStepBack: true,

    // make VS Code support data breakpoints
    supportsDataBreakpoints: false,

    // make VS Code support completion in REPL
    supportsCompletionsRequest: false,
    completionTriggerCharacters: ['.', '['],

    // make VS Code send cancel request
    supportsCancelRequest: false,

    // make VS Code send the breakpointLocations request
    supportsBreakpointLocationsRequest: true,

    // make VS Code provide "Step in Target" functionality
    supportsStepInTargetsRequest: false,

    // the adapter defines two exceptions filters, one with support for conditions.
    supportsExceptionFilterOptions: false,

    // make VS Code send exceptionInfo request
    supportsExceptionInfoRequest: false,

    // make VS Code send setVariable request
    supportsSetVariable: true,

    // make VS Code send setExpression request
    supportsSetExpression: false,

    // make VS Code send disassemble request
    supportsDisassembleRequest: false,
    supportsSteppingGranularity: false,
    supportsInstructionBreakpoints: false
}