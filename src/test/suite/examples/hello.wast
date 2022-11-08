(module
  (type (;0;) (func (param i32 i32)))
  (type (;1;) (func (param i32)))
  (type (;2;) (func))
  (import "env" "print_string" (func (;0;) (type 0)))
  (func (;1;) (type 2)
    i32.const 0
    i32.const 12
    call 0)
  (memory (;0;) 1)
  (export "main" (func 1))
  (data (;0;) (i32.const 0) "Hello World!"))
