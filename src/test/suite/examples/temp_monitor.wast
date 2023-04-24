(module
 (type $i32tovoid                   (func (param i32)   (result)))
 (type $i32toi32                    (func (param i32) (result i32)))
 (type $i32tof32                    (func (param i32) (result f32)))
 (type $f32tovoid                   (func (param f32) (result)))
 (type $voidtovoid                  (func (param) (result)))
 (type $voidtof32                   (func (param) (result f32)))
 (type $voidtoi32                   (func (param) (result i32)))
 (type $callbackType                (func (param i32 i32 i32 i32 i32) (result)))
 (type $subscribeType               (func (param i32 i32 i32) (result)))
 (type $int32->int32->void          (func (param i32 i32)))

 (import "env" "chip_delay"          (func $delay       (type $i32tovoid)))
 (import "env" "print_int"           (func $print       (type $f32tovoid)))
 (import "env" "req_temp"            (func $reqTemp     (type $i32tof32)))
 (import "env" "subscribe_interrupt" (func $subscribeInterrupt (type $subscribeType)))
 (import "env" "chip_pin_mode"       (func $env.chip_pin_mode (type $int32->int32->void)))
 (import "env" "chip_digital_write"  (func $env.chip_digital_write (type $int32->int32->void)))


 (export "main"                     (func $main))

 (global $connectedStatus (mut i32) (i32.const 1))
 (global $sensorA i32 (i32.const 3030))
 (global $sensorB i32 (i32.const 3031))
 (global $connected (mut f32) (f32.const 0))
 (global $wifiBtn i32 (i32.const 37))
 (global $inputPullUp i32 (i32.const 5))
 
 ;; LED
 (global $led i32 (i32.const 10))
 (global $ledStatus (mut i32) (i32.const 0))

 (memory $memory 1)
 (table 1 funcref)
 (elem $e0 (i32.const 0) $disconnectSensors)

(func $toggleLed (type $voidtovoid)
    global.get $ledStatus
    i32.eqz
    (if (result i32)
        (then i32.const 1)
        (else i32.const 0))
    global.set $ledStatus
    
    global.get $led
    global.get $ledStatus
    call $env.chip_digital_write)


(func $isConnected (type $i32toi32)
    global.get $connectedStatus)

(func $disconnectSensors (type $callbackType)
    i32.const 0
    (global.set $connectedStatus))

(func $initPins (type $voidtovoid)
    
    ;; set button pinmode
    global.get $wifiBtn
    global.get $inputPullUp
    call $env.chip_pin_mode
    
    ;; check that led works
    global.get $led
    i32.const 1
    call $env.chip_digital_write

    ;; attach callback to pin
    global.get $wifiBtn ;; pin
    i32.const 0 ;; Table idx of $disconnectSensors
    i32.const 1 ;; trigger callback on CHANGE
    call $subscribeInterrupt
    
    ;; set led pinmode
    global.get $led
    i32.const 2
    call $env.chip_pin_mode)

(func $inc_connected (type $voidtovoid)
    (f32.add
      (global.get $connected)
      (f32.const 1))
    (global.set $connected))

(func $getTemp (type $i32tof32)
    (local.get 0)
    (call $isConnected)
    (if (result f32)
        (then 
         (call $inc_connected)
         (local.get 0)
         (call $reqTemp))
        (else
          (f32.const 0.0))))

(func $avgTemp (type $voidtof32)
    (global.get $sensorA)
    (call $getTemp)
    (global.get $sensorB)
    (call $getTemp)
    f32.add
    (global.get $connected)
    f32.div)


 (func $main (type $voidtovoid)
    (call $initPins)
    (loop 
       (global.set $connected (f32.const 0))
       (call $avgTemp)
       (call $print)
       (call $toggleLed)
       ;;sleep 2sec
       (i32.const 2000)
       (call $delay)
       (br 0))))