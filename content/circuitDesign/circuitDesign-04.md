# Understanding VHDL Operators and Attributes: A Simple Guide

VHDL is a hardware description language used for designing digital circuits. To use VHDL effectively, you need to understand its operators and attributes. This article explains these concepts in a beginner-friendly way.

## What Are Operators?

Operators in VHDL allow you to perform different operations on your data. Let's look at the main types:

### Assignment Operators

These operators assign values to VHDL objects:
- `<=` assigns a value to a SIGNAL
- `:=` assigns a value to a VARIABLE or CONSTANT
- `=>` assigns values to array elements

For example:
```vhdl
SIGNAL y: STD_LOGIC_VECTOR(1 TO 4);
y <= "0000"; -- Assigns "0000" to signal y
y <= (OTHERS=>'0') -- Assigns '0' to all elements of y
```

### Logical Operators

These perform logical operations like AND, OR, and NOT:
- NOT
- AND
- NAND
- OR
- NOR
- XOR
- XNOR

They work with data types like BIT, BIT_VECTOR, and BOOLEAN.

### Arithmetic Operators

These perform math operations:
- Addition (+)
- Subtraction (-)
- Multiplication (*)
- Division (/)
- Exponentiation (**)
- Absolute value (ABS)
- Remainder (REM)
- Modulo (MOD)

For example, `7 MOD 3` equals 1, while `7 REM 3` also equals 1.

### Comparison Operators

These compare values:
- Equal to (=)
- Not equal to (/=)
- Less than (<)
- Greater than (>)
- Less than or equal to (<=)
- Greater than or equal to (>=)

### Shift Operators

These shift bits in a vector:
- Shift left logic (SLL): Right positions filled with '0's
- Shift right logic (SRL): Left positions filled with '0's
- Shift left arithmetic (SLA): Rightmost bit replicated
- Shift right arithmetic (SRA): Leftmost bit replicated
- Rotate left (ROL): Circular shift left
- Rotate right (ROR): Circular shift right

Example:
```vhdl
x <= "01001";
y <= x SLL 2; -- Result: "00100"
```

### Concatenation Operator

The `&` symbol joins values together:
```vhdl
z <= (x & "11111" & y); -- Combines values
```

### Matching Comparison Operators

Introduced in VHDL 2008, these compare logic values:
- Matching equality (?=)
- Matching inequality (?/=)
- And others (?<, ?>, ?<=, ?>=)

These operators treat 'H' and '1' as the same logic value.

## What Are Attributes?

Attributes retrieve information about VHDL objects or types. They are denoted with a tick mark (').

### Predefined Attributes of Scalar Types

These give information about numeric, enumerated, or physical types:
```vhdl
TYPE my_integer IS RANGE 0 TO 255;
x1 <= my_integer'LEFT; -- Result is 0
x2 <= my_integer'RIGHT; -- Result is 255
```

### Predefined Attributes of Array Types

These give information about arrays:
```vhdl
TYPE matrix IS ARRAY (1 TO 4, 7 DOWNTO 0) OF BIT;
x1 <= matrix'LEFT(1); -- Result is 1
x5 <= matrix'LENGTH(2); -- Result is 8
```

### Predefined Attributes of Signals

The most common is `'EVENT`:
```vhdl
IF (clk'EVENT AND clk='1') THEN -- Detects rising edge
```

Other useful signal attributes include:
- `'STABLE`
- `'QUIET`
- `'LAST_VALUE`

## User-Defined Attributes

You can create your own attributes with two steps:
1. Attribute declaration
2. Attribute specification

Example:
```vhdl
ATTRIBUTE pins: POSITIVE; -- Declaration
ATTRIBUTE pins OF nand3: COMPONENT IS 4; -- Specification
```

## Synthesis Attributes

These communicate with the compiler:

### enum_encoding Attribute

This sets encoding for finite state machines:
```vhdl
TYPE state IS (A, B, C, D);
ATTRIBUTE enum_encoding: STRING;
ATTRIBUTE enum_encoding OF state: TYPE IS "sequential";
-- Result: A="00", B="01", C="10", D="11"
```

### chip_pin Attribute

This assigns device pins to signals:
```vhdl
ATTRIBUTE chip_pin: STRING;
ATTRIBUTE chip_pin OF clk: SIGNAL IS "N2";
```

### keep Attribute

This prevents the compiler from simplifying (removing) nodes:
```vhdl
ATTRIBUTE keep: BOOLEAN;
ATTRIBUTE keep OF a, b, c: SIGNAL IS TRUE;
```

### preserve and noprune Attributes

These prevent the removal of registers (flip-flops). The `noprune` attribute also preserves registers that don't feed the top-level entity.

## GROUP and ALIAS

### GROUP

GROUP applies an attribute to multiple entities:
```vhdl
GROUP test_signals IS (SIGNAL, SIGNAL, SIGNAL);
GROUP register: test_signals (clock, reset, enable);
```

### ALIAS

ALIAS gives an alternate name to an existing entity:
```vhdl
SIGNAL data_bus: STD_LOGIC_VECTOR(31 DOWNTO 0);
ALIAS upper_bus IS data_bus(31 DOWNTO 16);
```

## Summary

Understanding operators and attributes is essential for effective VHDL coding. Operators perform actions on data, while attributes provide information about VHDL objects. User-defined and synthesis attributes give you additional control over your designs.

These concepts form the foundation for more complex VHDL designs, especially when working with finite state machines and timing-sensitive circuits.