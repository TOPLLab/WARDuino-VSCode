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

class MochaReporter extends reporters.Base {
    private framework: Framework;
    private coreReporter: Reporter;

    private archiver: Archiver;

    private readonly indentationSize: number = 2;
    private indentationLevel: number = 0;

    private passed: number = 0;  // number of passed suites
    private skipped: number = 0;  // number of skipped suites

    private failed: number = 0;  // number of failed suites
    public failures = Array<any>();  // array to keep failed tests of suite (temporarily)

    private timeouts: number = 0;  // number of timed out actions

    constructor(runner: Runner, options?: MochaOptions) {
        super(runner, options);

        this.framework = Framework.getImplementation();
        this.coreReporter = new Reporter(this.framework);

        this.archiver = new Archiver(`${process.env.TESTFILE?.replace('.asserts.wast', '.wast') ?? 'suite'}.${Date.now()}.log`);
        this.archiver.set('date', new Date(Date.now()).toISOString());

        runner.on(Runner.constants.EVENT_RUN_BEGIN, () => {
            console.log(color('suite', '%sGeneral Information'), this.indent(this.indentationLevel + 2));
            console.log(color('suite', '%s==================='), this.indent(this.indentationLevel + 2));

            const names: string[] = [];
            Framework.getImplementation().platforms().forEach((platform: Platform) => names.push(platform.name + (platform.disabled ? ' (disabled)' : '')));
            names.forEach((name: string) => this.archiver.extend('platforms', name));
            console.log(color('suite', '%sPlatforms  %s'), this.indent(this.indentationLevel + 2), names.join(', '));

            console.log(color('suite', '%sVM commit  %s'), this.indent(this.indentationLevel + 2), 'eee5468'); // TODO get actual vm commit
        });

        runner.on(Runner.constants.EVENT_SUITE_BEGIN, (suite: Suite) => {
            ++this.indentationLevel;
            console.log(color('suite', '%s%s'), this.indent(), suite.title);
        });

        runner.on(Runner.constants.EVENT_SUITE_END, (suite: Suite) => {
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

            --this.indentationLevel;
            if (this.indentationLevel === 1) {
                console.log();
            }
        });

        runner.on(Runner.constants.EVENT_TEST_PASS, (test) => {
            let format = this.indent() + color('checkmark', '  ' + symbols.ok) + ' %s';

            if (test.speed === 'fast' || test.speed === undefined) {
                console.log(format, test.title);
            } else {
                format += color(test.speed, ' (%dms)');
                console.log(format, test.title, test.duration);
            }
        });

        runner.on(Runner.constants.EVENT_TEST_FAIL, (test: Test, error: any) => {
            console.log(this.indent(this.indentationLevel + 1) + color('fail', symbols.err + ' %s'), test.title);
            console.log(color('error', `${this.indent(this.indentationLevel + 2)} ${this.reportFailure(error)}`));

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
            this.timeouts += error.message?.toString().includes('timeout') ? 1 : 0;
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
                console.log(fmt, stats.failures);

                // percentage of failures due to timeouts
                fmt = color('error', `${this.indent()}%d timeouts`) + color('light', ' (%d%)');

                this.archiver.set('timed out actions', this.timeouts);
                console.log(fmt, this.timeouts, this.timeouts / stats.failures);
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

    private reportFailure(failure: any): string | undefined {
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