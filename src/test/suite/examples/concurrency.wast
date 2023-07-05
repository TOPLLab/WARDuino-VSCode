(module
  ;; Type declaration
  (type $void->void                       (func))
  (type $int32->void                      (func (param i32)))
  (type $int32->int32                     (func (param i32) (result i32)))
  (type $int32->int32->void               (func (param i32 i32)))
  (type $int32->int32->int32->void        (func (param i32 i32 i32)))
  (type $int32->int32->int32->int32->void (func (param i32 i32 i32 i32 i32)))

  ;; Imports
  (import "env" "chip_delay"          (func $env.chip_delay          (type $int32->void)))
  (import "env" "chip_digital_read"   (func $env.chip_digital_read   (type $int32->int32)))
  (import "env" "chip_pin_mode"       (func $env.chip_pin_mode       (type $int32->int32->void)))
  (import "env" "chip_digital_write"  (func $env.chip_digital_write  (type $int32->int32->void)))
  (import "env" "chip_analog_write"   (func $env.chip_analog_write   (type $int32->int32->void)))
  (import "env" "subscribe_interrupt" (func $env.subscribe_interrupt (type $int32->int32->int32->void)))

  ;; Non-mutable globals
  (global $FALLING i32 (i32.const 2))
  (global $up i32 (i32.const 25))
  (global $down i32 (i32.const 33))
  (global $led i32 (i32.const 26))

  (global $max i32 (i32.const 250))

  (global $delta (mut i32) (i32.const 0))
  (global $state (mut i32) (i32.const 250))

  ;; Callback function to execute when the button is pressed
  (func $increase (type $int32->int32->int32->int32->void)
                  (param $p0 i32) (param $p1 i32) (param $p2 i32) (param $p3 i32) (param $p4 i32)
    i32.const 50
    global.set $delta)

  (func $decrease (type $int32->int32->int32->int32->void)
                  (param $p0 i32) (param $p1 i32) (param $p2 i32) (param $p3 i32) (param $p4 i32)
    i32.const -50
    global.set $delta)

  ;; Add callback function to table
  (table $function-table 3 funcref)
  (elem (i32.const 1) func $increase)
  (elem (i32.const 2) func $decrease)

  (memory $memory 1)  ;; memory to save callback topic and payloads

  ;; Main function
  (func $main (type $void->void)
    (local $new i32)
    ;; Initialize pin modes
    global.get $up
    i32.const 0
    call $env.chip_pin_mode
    global.get $down
    i32.const 0
    call $env.chip_pin_mode
    global.get $led
    i32.const 2
    call $env.chip_pin_mode

    ;; Subscribe callback to button interrupt on FALLING
    global.get $up
    i32.const 1  ;; callback function index in table $function-table
    global.get $FALLING
    call $env.subscribe_interrupt
    
    ;; Subscribe callback to button interrupt on FALLING
    global.get $down
    i32.const 2  ;; callback function index in table $function-table
    global.get $FALLING
    call $env.subscribe_interrupt

    ;; Remain idle until button is pressed
    loop $idle
      global.get $state
      global.get $delta
      i32.add
      local.tee $new
      i32.const 0
      i32.ge_s
      if
        local.get $new
        global.get $max
        i32.le_s
        if
          local.get $new
          global.set $state
        end
      end

      i32.const 0
      global.set $delta

      global.get $led
      global.get $state
      call $env.chip_analog_write
      i32.const 30
      call $env.chip_delay          ;; wait
      br $idle
    end)

  (export "main" (func $main)))

