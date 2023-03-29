(module
  (type $i32->i32->void (func (param i32 i32)))
  (type $i32->i32->i32->void (func (param i32 i32 i32)))
  (type $void->i32 (func (result i32)))
  (type $void->void (func))

  (import "env" "chip_analog_write" (func $env.analogWrite (type $i32->i32->i32->void)))
  (import "env" "chip_ledc_setup" (func $env.ledcSetup (type $i32->i32->i32->void)))
  (import "env" "chip_ledc_attach_pin" (func $env.ledcAttachPin (type $i32->i32->void)))
  (import "env" "subscribe_interrupt" (func $env.subscribeInterrupt (type $i32->i32->i32->void)))

  (global $led i32 (i32.const 10)) ;; analog led pin
  (global $brigthness (mut i32) (i32.const 0))
  (global $maxBrigthness i32 (i32.const 255))
  (global $delta (mut i32) (i32.const 0))
  (global $upButton i32 (i32.const 37)) ;; button to change brightness
  (global $channel i32 (i32.const 0)) ;; channel for analog write
  
  ;; needed for subscribe_interrupt
  (memory $memory 1)
  (table 1 funcref)
  (elem (i32.const 0) func $incrDelta)

  (func $setupButton (type $void->void)
    ;; register up Button
    global.get $upButton
    i32.const 0 ;; Table idx of $incrDelta
    i32.const 2 ;; trigger callback on CHANGE
    (call $env.subscribeInterrupt))
      
  (func $initLed (type $void->void)
    (local $freq i32)
    (local $ledcTimer i32)
    (local.set $freq (i32.const 5000))
    (local.set $ledcTimer (i32.const 12))

    global.get $channel
    local.get $freq
    local.get $ledcTimer
    (call $env.ledcSetup)

    global.get $led
    global.get $channel
    (call $env.ledcAttachPin))

  (func $incrDelta  (type $void->void)
    (i32.add
      (global.get $delta)
      (i32.const 10))
    global.set $delta)

  (func $isDeltaNotZero (type $void->i32)
    (i32.ne
      (i32.const 0)
      (global.get $delta)))

  (func $updateBrightness (type $void->void)
    (local $newBrightness i32)

    ;; change global $brigthness
    (i32.add (global.get $brigthness)
             (global.get $delta))
    local.set $newBrightness
     
    ;; if newbrightness greater than max rebase brightness
    (if (i32.gt_u
          (local.get $newBrightness)
          (global.get $maxBrigthness))
        (then
          (i32.sub
            (local.get $newBrightness)
            (global.get $maxBrigthness))
           global.set $brigthness)
        (else
          (local.get $newBrightness)
          global.set $brigthness))

    ;; write to pin
    global.get $channel
    global.get $brigthness
    global.get $maxBrigthness
    (call $env.analogWrite)

    ;; reset delta
    i32.const 0
    global.set $delta)
  
  (func $main  (type $void->void)
    (call $initLed)
    (call $setupButton)

    (loop $infinite
      (if (call $isDeltaNotZero)
          (then
            (call $updateBrightness))
          (else nop))
      (br $infinite)))
  (export "main" (func $main)))
