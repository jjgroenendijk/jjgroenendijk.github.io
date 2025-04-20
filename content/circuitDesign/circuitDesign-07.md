# Understanding SIGNAL and VARIABLE in VHDL: A Comprehensive Guide

VHDL uses different objects to deal with values in your designs. The main ones are CONSTANT, SIGNAL, and VARIABLE. Today we'll focus on SIGNAL and VARIABLE since they're essential for creating working digital circuits.

## What is a SIGNAL?

A SIGNAL represents circuit interconnects or wires. It passes values in and out of your circuit and between internal units. All ports in an entity are signals by default.

You can declare signals in the declarative part of ENTITY, ARCHITECTURE, PACKAGE, BLOCK, and GENERATE. The basic syntax looks like this:

```vhdl
SIGNAL signal_name: signal_type [range] [:= default_value];
```

For example:
```vhdl
SIGNAL flag: STD_LOGIC := '0';
SIGNAL address: NATURAL RANGE 0 TO 2**N-1;
SIGNAL data: BIT_VECTOR(15 DOWNTO 0);
```

Signals can have special features like resolution functions (to handle multiple drivers) and guarded signals (to handle high-impedance states).

## What is a VARIABLE?

A VARIABLE is useful for sequential code. Unlike signals, variables are only visible inside the sequential unit where they're created. The only exception is shared variables.

You can declare variables in PROCESS, FUNCTION, PROCEDURE, PACKAGE, and PACKAGE BODY. The syntax is:

```vhdl
VARIABLE variable_name: variable_type [range] [:= default_value];
```

For example:
```vhdl
VARIABLE flag: STD_LOGIC := '0';
VARIABLE address: NATURAL RANGE 0 TO 2**N-1;
VARIABLE data: BIT_VECTOR(15 DOWNTO 0);
```

A shared variable can be accessed by more than one sequential code unit. It must be declared in ENTITY, ARCHITECTURE, BLOCK, GENERATE, or PACKAGE.

## Key Differences Between SIGNAL and VARIABLE

There are six important rules to understand:

### 1. Where You Can Declare Them

SIGNAL: Can be declared in ENTITY, ARCHITECTURE, PACKAGE, BLOCK, or GENERATE.

VARIABLE: Can only be declared in sequential units (PROCESS and subprograms), except for shared variables.

### 2. Scope (Where You Can Use Them)

SIGNAL: Can be global (seen and modified across the whole code).

VARIABLE: Always local (seen and modified only inside the sequential unit where it was created). To use its value elsewhere, you must pass it to a signal.

### 3. Update Timing

SIGNAL: A new value is only available after the current process or subprogram finishes.

VARIABLE: Updated immediately, so the new value is ready to use in the next line of code.

### 4. Assignment Operator

SIGNAL: Values are assigned using "<=" (example: sig <= 5;).

VARIABLE: Values are assigned using ":=" (example: var := 5;).

### 5. Multiple Assignments

SIGNAL: Only one effective assignment is allowed in the whole code.

VARIABLE: Multiple assignments are fine because the update is immediate.

### 6. Register Inference

SIGNAL: Flip-flops are created when a signal gets assigned a value at the transition of another signal.

VARIABLE: Flip-flops are created when a variable gets assigned at the transition of a signal and this variable's value eventually affects a signal.

## Practical Example: Counters

Consider two counters: one using a signal, one using a variable. Both should count from 0 to 9.

With a signal:
```vhdl
PROCESS(clk)
BEGIN
  IF (clk'EVENT AND clk='1') THEN
    temp1 <= temp1 + 1;
    IF (temp1=10) THEN
      temp1 <= 0;
    END IF;
  END IF;
  count1 <= temp1;
END PROCESS;
```

With a variable:
```vhdl
PROCESS(clk)
VARIABLE temp2: INTEGER RANGE 0 TO 10;
BEGIN
  IF (clk'EVENT AND clk='1') THEN
    temp2 := temp2 + 1;
    IF (temp2=10) THEN
      temp2 := 0;
    END IF;
  END IF;
  count2 <= temp2;
END PROCESS;
```

The signal-based counter will actually count from 0 to 10 instead of 0 to 9. This happens because the signal's new value is only available after the process finishes. The variable-based counter works as expected since the variable updates immediately.

## Register Inference

Flip-flops (registers) are created in your circuit when:
- A value is assigned to a signal at the transition of another signal
- A value is assigned to a variable at the transition of another signal, and this value affects a signal

For example, in this code:
```vhdl
IF (clk'EVENT AND clk='1') THEN
  sig1 <= x;
  sig2 <= y;
  var := z;
END IF;
```

All three objects (sig1, sig2, and var) will be stored in flip-flops.

## Dual-Edge Circuits

Most FPGA devices only support single-edge flip-flops. If you need dual-edge functionality (circuits that respond to both rising and falling clock edges), you need special design techniques.

A common approach uses two D-type latches connected in parallel with a multiplexer, creating a circuit that behaves like a dual-edge flip-flop.

## Multiple Signal Assignments

Remember that only one effective assignment is allowed to a signal in the whole code. If you need to build circuits like parity detectors, you'll need special techniques.

One solution is to use a signal with a higher dimension. For example, if you're computing a single bit output, use a 1D signal internally:

```vhdl
SIGNAL temp: BIT_VECTOR(N-1 DOWNTO 0);
```

This allows you to assign to different parts of the signal (like temp(0), temp(1), etc.) which avoids violating the multiple assignments rule.

## When to Use SIGNAL vs. VARIABLE

Use SIGNAL when:
- You need to pass values between different parts of your design
- You want to represent physical wires
- You're working with global values

Use VARIABLE when:
- You need local storage in a process
- You need immediate updates (like counters)
- You're doing sequential calculations that build on previous results

Understanding these differences will help you write better VHDL code and avoid common pitfalls in your digital designs.