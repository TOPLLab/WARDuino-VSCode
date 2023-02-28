import {MochaOptions, reporters, Runner, Suite, Test} from 'mocha';
import {Reporter} from './Reporter';
import {Framework, Platform} from './Framework';
import {Archiver} from './Archiver';
import color = reporters.Base.color;
import colors = reporters.Base.colors;
import symbols = reporters.Base.symbols;

/* Change color output */

colors.suite = 95; // purple
colors.fail = 90; // grey
colors.error = 31; // red

/* Helper functions for formatting */

function seconds(ms: number): string {
    return `${(ms / 1000).toFixed(0)}s`;
}

function formatThrownError(message: string): string {
    const substring = message.match(/the string "(.*)" was/);
    return substring !== null ? substring[1] : message;
}

function formatTimout(message: string): string {
    const limit = message.match(/Timeout of ([0-9]*)ms exceeded./);
    if (limit) {
        return `test exceeded time limit (${limit[1]}ms)`;
    }
    return message;
}

/** Custom Reporter for Describer framework */

declare global {
}

interface Result {
    test: Test;
    passed: boolean;
    error?: any;
}

class MochaReporter extends reporters.Base {
    private framework: Framework;
    private coreReporter: Reporter;

    private archiver: Archiver;

    private results: Result[][];
    private currentStep: number = 0;

    private readonly indentationSize: number = 2;
    private indentationLevel: number = 2;

    private passed: number = 0;  // number of passed suites
    private skipped: number = 0;  // number of skipped suites

    private failed: number = 0;  // number of failed suites
    public failures = Array<any>();  // array to keep failed tests of suite (temporarily)
    private ignore: number = 0;

    private timeouts: number = 0;  // number of timed out actions

    constructor(runner: Runner, options?: MochaOptions) {
        super(runner, options);

        this.framework = Framework.getImplementation();
        this.coreReporter = new Reporter(this.framework);

        this.archiver = new Archiver(`${process.env.TESTFILE?.replace('.asserts.wast', '.wast') ?? 'suite'}.${Date.now()}.log`);
        this.archiver.set('date', new Date(Date.now()).toISOString());

        this.results = [];

        runner.on(Runner.constants.EVENT_RUN_BEGIN, () => {
            console.log(color('suite', '%sGeneral Information'), this.indent());
            console.log(color('suite', '%s==================='), this.indent());

            const names: string[] = [];
            Framework.getImplementation().platforms().forEach((platform: Platform) => names.push(platform.name + (platform.disabled ? ' (disabled)' : ` (${platform.scheduler.identifier})`)));
            names.forEach((name: string) => this.archiver.extend('platforms', name));
            console.log(color('suite', '%sPlatforms  %s'), this.indent(), names.join(', '));

            console.log(color('suite', '%sVM commit  %s'), this.indent(), 'eee5468'); // TODO get actual vm commit
        });

        runner.on(Runner.constants.EVENT_SUITE_BEGIN, (suite: Suite) => {
            console.log(color('suite', '%s%s'), this.indent(), suite.title);
        });

        runner.on(Runner.constants.EVENT_SUITE_END, (suite: Suite) => {
            this.report();
            this.results = [];
            this.currentStep = 0;

            if (suite.isPending()) {
                let format = this.indent(this.indentationLevel + 1) + '\u25D7 Skipping test';
                this.skipped++;
                console.log(format);
            } else if (this.failures.length > 0) {
                this.failed++;
                this.archiver.extend('failures', suite.title);
            } else if (suite.title.length > 0) {
                this.passed++;
                this.archiver.extend('passes', suite.title);
            }

            this.reportFailure(this.failures);
            this.failures = Array<any>();

            if (this.indentationLevel === 2) {
                console.log();
            }
        });

        runner.on(Runner.constants.EVENT_TEST_PASS, (test) => {
            if (this.framework.runs > 1) {
                this.aggregate({test, passed: true});
            } else {
                this.indentationLevel += 1;
                this.reportResult({test, passed: true});
                this.indentationLevel -= 1;
            }
        });

        runner.on(Runner.constants.EVENT_TEST_FAIL, (test: Test, error: any) => {
            if (this.framework.runs > 1) {
                this.aggregate({test, passed: false, error});
            } else {
                this.indentationLevel += 1;
                this.reportResult({test, passed: false, error});
                this.indentationLevel -= 1;
            }

            if (error.message?.toString().includes('failed dependent')) {
                this.skipped++;
                this.passed--;
                return;
            }

            if (error.message?.toString().includes('unable to flash')) {
                this.skipped++;
                this.failed--;
                return;
            }

            this.failures.push(error);
        });

        runner.once(Runner.constants.EVENT_RUN_END, () => {
            const stats = runner.stats;

            this.archiver.set('duration (ms)', stats?.duration ?? NaN);

            console.log();
            this.indentationLevel = 2;

            console.log(color('suite', '%sTest Suite Results'), this.indent());
            console.log(color('suite', '%s==================\n'), this.indent());

            console.log(color('suite', '%sScenarios:'), this.indent());

            this.indentationLevel += 1;

            // passes
            let fmt =
                color('bright pass', this.indent()) +
                color('green', '%d passing') +
                color('light', ' (%s)');

            this.archiver.set('passed scenarios', this.passed);
            console.log(fmt, this.passed, seconds(stats?.duration ?? 0));

            fmt = color('pending', this.indent()) + color('pending', '%d skipped');

            this.archiver.set('skipped scenarios', this.skipped);
            console.log(fmt, this.skipped);

            // failures
            if (stats?.failures) {
                fmt = color('error', `${this.indent()}%d failing`);

                this.archiver.set('failed scenarios', this.failed);
                console.log(fmt, this.failed);

                this.failures.forEach((failure) => {
                    this.reportFailure(failure);
                });
                console.log();
            }

            console.log();

            this.indentationLevel -= 1;

            console.log(color('suite', '%sActions:'), this.indent());

            this.indentationLevel += 1;

            // number of passed/failed actions

            fmt =
                color('bright pass', this.indent()) +
                color('green', '%d passing');

            this.archiver.set('passed actions', stats?.passes || 0);
            console.log(fmt, stats?.passes || 0);

            // pending
            if (stats?.pending) {
                fmt = color('pending', this.indent()) + color('pending', '%d skipped');

                this.archiver.set('skipped actions', stats?.pending || 0);
                console.log(fmt, stats?.pending);
            }

            // failures
            if (stats?.failures) {
                fmt = color('error', `${this.indent()}%d failing`);

                this.archiver.set('failed actions', stats.failures);
                console.log(fmt, stats.failures - this.ignore);

                // percentage of failures due to timeouts
                fmt = color('error', `${this.indent()}%d timeouts`) + color('light', ' (%d%)');

                this.archiver.set('timed out actions', this.timeouts);
                console.log(fmt, this.timeouts, ((this.timeouts / (stats.failures - this.ignore)) * 100).toFixed(0));
            }


            console.log();

            this.indentationLevel -= 1;

            console.log(color('suite', '%sExpectations:'), this.indent());

            this.indentationLevel += 1;

            // number of passed/failed expectations

            this.indentationLevel -= 1;

            console.log();

            console.log(color('suite', '%sSuite Health:'), this.indent());

            // increases/decreases in execution time

            // increases/decreases in failures

            // increases/decreases in flakiness

            console.log();

            this.archiver.write();
        });
    }

    private indent(override?: number): string {
        return ' '.repeat((override ?? this.indentationLevel) * this.indentationSize);
    }

    private aggregate(result: Result) {
        if (result.test.title.includes('resetting before retry')) {
            this.currentStep = 0;
            this.ignore += result.passed ? 0 : 1;
        } else {
            if (this.results[this.currentStep] === undefined) {
                this.results[this.currentStep] = [];
            }

            this.results[this.currentStep++].push(result);
        }
    }

    // Report aggregate results of analysis run
    private report() {
        this.indentationLevel += 1;
        for (let i = 0; i < this.currentStep; i++) {
            const success = this.results[i].every((result: Result) => result.passed);
            const base: Result = this.results[i][0];
            this.reportResult({test: base.test, passed: success});

            const flakiness: number = this.results[i].filter((result: Result) => result.passed).length / this.results[i].length;
            if (0 < flakiness && flakiness < 1) {
                console.log(this.indent(this.indentationLevel + 1) + `Flakiness: ${(flakiness * 100).toFixed(0)}% passed [${this.results[i].length} runs]`);
            }

            for (const result of this.results[i]) {
                if (result?.error) {
                    console.log(color('error', `${this.indent(this.indentationLevel + 2)}${this.reportFailure(result.error)}`));
                }
            }
        }
        this.indentationLevel -= 1;
    }

    private reportResult(result: Result) {
        let title = this.indent() + color((result.passed ? 'checkmark' : 'fail'), (result.passed ? symbols.ok : symbols.err)) + ' %s';

        if (this.results.length === 1 && result.test.speed !== 'fast' && result.test.speed !== undefined) {
            title += color(result.test.speed, ` (${result.test.duration}ms)`);
        }

        console.log(title, result.test.title);

        if (result?.error) {
            console.log(color('error', `${this.indent(this.indentationLevel + 2)}${this.reportFailure(result.error)}`));
        }
    }

    private reportFailure(failure: any): string | undefined {
        this.timeouts += failure.message?.toString().includes('timeout') ? 1 : 0;

        const message = failure.message?.toString();

        let prologue = 'Failure: ';
        if (skippedTest(failure)) {
            return message;
        } else if (showCustomComparatorError(failure)) {
            return prologue + message.split(':').slice(0, -1).join('');
        } else if (showDifference(failure)) {
            return prologue + `runtime returned '${failure.actual}' (expected: ${failure.expected})`;
        } else if (message?.includes('throw an Error :)')) {
            return prologue + formatThrownError(message);
        } else if (message?.includes('Timeout')) {
            return prologue + formatTimout(message);
        } else {
            return prologue + message;
        }
    }
}

function skippedTest(failure: any): boolean {
    return failure.message?.includes('Skip');
}

function showDifference(failure: any): boolean {
    return failure.showDiff && failure.actual !== failure.exception;
}

function showCustomComparatorError(failure: any): boolean {
    return failure.showDiff && failure.expected === true;
}

export = MochaReporter;