export enum InterruptTypes {
    // Remote debugging messages
    interruptRUN = '01',
    interruptHALT = '02',
    interruptPAUSE = '03',
    interruptSTEP = '04',
    interruptBPAdd = '06',
    interruptBPRem = '07',
    interruptDUMP = '10',
    interruptDUMPLocals = '11',
    interruptDUMPFull = '12',
    interruptUPDATEFun = '20',
    interruptUPDATEMod = '22',
    // Pull debugging messages
    interruptWOODDump = '60',
    interruptOffset = '61',
    interruptWOODRecvState = '62', // WOOD Change state
    interruptMonitorProxies = '63',
    interruptProxyCall = '64',
    interruptProxify = '65',
    // Push debugging messages
    interruptDUMPAllEvents = '70',
    interruptDUMPEvents = '71',
    interruptPOPEvent = '72',
    interruptPUSHEvent = '73',
    interruptDUMPCallbackmapping = '74',
    interruptRecvCallbackmapping = '75'
}
