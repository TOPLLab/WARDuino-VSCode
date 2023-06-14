export enum InterruptTypes {
    // Remote debugging messages
    interruptRUN = '01',
    interruptHALT = '02',
    interruptPAUSE = '03',
    interruptSTEP = '04',
    interruptBPAdd = '06',
    interruptBPRem = '07',
    interruptInspect = '09',
    interruptDUMP = '10',
    interruptDUMPLocals = '11',
    interruptDUMPFull = '12',
    interruptReset = '13',
    interruptUPDATEFun = '20',
    interruptUPDATELocal = '21',
    interruptUPDATEModule = '22',
    interruptUPDATEGlobal = '23',
    interruptUPDATEStackValue = '24',

    interruptINVOKE = '40',
    // Pull debugging messages
    interruptSnapshot = '60',
    interruptLoadSnapshot = '62',
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
