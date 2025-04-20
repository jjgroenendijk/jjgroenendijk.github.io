# Understanding Sequential Code in VHDL: A Beginner's Guide

Sequential code is a fundamental concept in VHDL that every digital designer needs to understand. Let's break down what it is and how it works in simple terms.

## Sequential vs. Concurrent Code

VHDL supports two main types of code:

- **Concurrent code**: Used mainly for designing combinational circuits. The statements execute in parallel.
- **Sequential code**: Can be used for both sequential and combinational circuits. The statements execute in order, one after another.

The main sequential code structures in VHDL are PROCESS, FUNCTION, and PROCEDURE. This article focuses on PROCESS, which is the most common form used in the main architecture body.

## Signals vs. Variables: Key Differences

Before diving into sequential code, you need to understand the difference between SIGNAL and VARIABLE:

**SIGNAL properties:**
- Declared outside sequential code
- Not updated immediately (only after the current process run completes)
- Signal assignments at transitions can create registers
- Only one effective assignment allowed in the whole code

**VARIABLE properties:**
- Declared and used inside PROCESS or subprograms
- Updated immediately (can be used in the next line)
- Variable assignments at transitions can create registers
- Multiple assignments are allowed

## Latches and Flip-Flops

Sequential circuits rely on components that can store state. The two fundamental types are:

**Latches**: Level-sensitive devices that are transparent during an entire clock level.
- D Latch (DL): Transparent when clock is high (or low)

**Flip-Flops**: Edge-sensitive devices that only capture input during clock transitions.
- D Flip-Flop (DFF): Captures input at rising (or falling) clock edge

DFFs are the most common storage elements in digital design. They appear in almost all sequential designs.

## The PROCESS Statement

A PROCESS is a sequential section of VHDL code. Here's a simplified syntax:

```vhdl
[label:] PROCESS [(sensitivity_list)] [IS]
  [declarative_part]
BEGIN
  sequential_statements_part
END PROCESS [label];
```

The sensitivity list contains signals that trigger the process when they change. Inside a PROCESS, you can only use sequential statements (IF, WAIT, LOOP, CASE).

## Sequential Statements

### The IF Statement

The IF statement is the most common sequential statement. It allows conditional execution:

```vhdl
IF conditions THEN
  assignments;
ELSIF conditions THEN
  assignments;
ELSE
  assignments;
END IF;
```

Example - DFF with reset:
```vhdl
IF (rst='1') THEN
  q <= '0';
ELSIF (clk'EVENT AND clk='1') THEN
  q <= d;
END IF;
```

### The WAIT Statement

WAIT pauses execution until a condition is met. There are three types:

- **WAIT UNTIL**: Waits until a condition becomes true
- **WAIT ON**: Waits until any signal in the list changes
- **WAIT FOR**: Used in simulations for timing

When using WAIT, the PROCESS cannot have a sensitivity list.

### The LOOP Statement

LOOP repeats code multiple times. The five versions are:

- **Unconditional LOOP**: Repeats forever unless exited
- **FOR LOOP**: Repeats a specific number of times
- **WHILE LOOP**: Repeats while a condition is true
- **LOOP with EXIT**: Can exit early when a condition is met
- **LOOP with NEXT**: Can skip iterations

Example - FOR LOOP:
```vhdl
FOR i IN 0 TO 5 LOOP
  x(i) <= a(i) AND b(5-i);
END LOOP;
```

### The CASE Statement

CASE evaluates an expression and executes code based on the result:

```vhdl
CASE expression IS
  WHEN value => assignments;
  WHEN value => assignments;
  WHEN OTHERS => assignments;
END CASE;
```

CASE requires that all possible input values are covered (complete truth table).

## CASE vs. SELECT

CASE and SELECT are similar, but CASE is for sequential code while SELECT is for concurrent code. Key differences:

- CASE allows multiple assignments per test
- CASE uses NULL for no action, while SELECT uses UNAFFECTED
- Both require complete truth tables

## Implementing Combinational Circuits with Sequential Code

Sequential code can implement both sequential and combinational circuits. For combinational circuits:

1. Always specify the complete truth table to avoid unwanted latches
2. Include all input signals used in the process in the sensitivity list

Failing to follow these rules can result in incorrect hardware being synthesized, including unwanted memory elements.

## VHDL 2008 Improvements

VHDL 2008 introduced several improvements to sequential code:

- Added the ALL keyword for sensitivity lists
- Allowed concurrent statements (WHEN, SELECT) inside sequential code
- Enabled boolean tests in IF and LOOP statements
- Added CASE? statement to match SELECT? for don't care inputs
- Extended UNAFFECTED keyword to sequential code

## Summary

Sequential code in VHDL provides a powerful way to describe both sequential and combinational circuits. Understanding the differences between signals and variables, along with mastering the four sequential statements (IF, WAIT, LOOP, and CASE), is essential for effective VHDL design. With these tools, you can create everything from simple flip-flops to complex digital systems.