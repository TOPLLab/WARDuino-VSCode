import {Describer} from '../framework/Describer';
import {EmulatorBridge} from './debugger.test';
const EMULATOR: string = `${require('os').homedir()}/Arduino/libraries/WARDuino/build-emu/wdcli`;

const cli: Describer = new Describer(new EmulatorBridge(EMULATOR));
