# Understanding Concurrent Code in VHDL

VHDL is a powerful hardware description language used for designing digital circuits. One of its key features is the ability to write concurrent code, which allows multiple operations to happen in parallel. This article explores concurrent code in VHDL and its applications in digital design.

## Combinational vs. Sequential Circuits

Before diving into concurrent code, it's important to understand the difference between combinational and sequential circuits:

- **Combinational logic circuits** have outputs that depend only on current inputs, with no memory elements.
- **Sequential logic circuits** have outputs that depend on previous states, requiring storage elements like D-type flip-flops (DFFs) and often a clock signal.

While VHDL concurrent code is primarily designed for combinational circuits, sequential circuits are typically implemented using sequential code (inside PROCESS, FUNCTION, or PROCEDURE).

## Concurrent Statements in VHDL

In VHDL, code can be either concurrent (parallel) or sequential. Concurrent statements execute in parallel, while sequential statements execute in order. There are three purely concurrent statements:

### The WHEN Statement

The WHEN statement is the simplest conditional statement in concurrent code. It works somewhat like the IF statement in sequential code. 

Basic syntax:
```vhdl
assignment_expression WHEN conditions ELSE
assignment_value WHEN conditions ELSE
...;
```

Example:
```vhdl
y <= '0' WHEN rst='0' ELSE
     '1' WHEN a='0' OR b='1' ELSE
     '-'; --don't care
```

### The SELECT Statement

The SELECT statement is another concurrent statement, similar to the CASE statement in sequential code.

Basic syntax:
```vhdl
WITH identifier SELECT
assignment_expression WHEN values,
assignment_value WHEN values,
...;
```

Example:
```vhdl
WITH control SELECT
y <= "000" WHEN 0 | 1,
     "100" WHEN 2 TO 5,
     "Z--" WHEN OTHERS;
```

The SELECT statement requires all input values to be covered, often using the OTHERS keyword.

### The GENERATE Statement

The GENERATE statement is used to repeat a section of code multiple times. It comes in two forms:

1. **Unconditional GENERATE (FOR-GENERATE)** - Creates multiple instances of code:
```vhdl
label: FOR identifier IN range GENERATE
    concurrent_statements_part
END GENERATE [label];
```

2. **Conditional GENERATE (IF-GENERATE)** - Includes an IF statement:
```vhdl
label: IF condition GENERATE
    concurrent_statements_part
END GENERATE [label];
```

GENERATE is particularly useful for creating repetitive structures or instantiating multiple components.

## Using Operators for Circuit Design

Basic circuits can be designed using only operators (AND, OR, NOT, etc.). This approach works well for simple logic or arithmetic circuits. For example, a 4×1 multiplexer can be implemented with logical operators:

```vhdl
y <= (NOT sel(1) AND NOT sel(0) AND x0) OR
     (NOT sel(1) AND sel(0) AND x1) OR
     (sel(1) AND NOT sel(0) AND x2) OR
     (sel(1) AND sel(0) AND x3);
```

## Implementing Arithmetic Circuits

When implementing arithmetic circuits in VHDL, it's important to consider:

1. The nature of the system (signed or unsigned)
2. The size of the result based on operand sizes
3. The handling of overflow and carry bits

For best practices:
- Use STD_LOGIC_VECTOR for interface ports (industry standard)
- Use SIGNED or UNSIGNED types internally
- Use the numeric_std package for arithmetic operations
- Explicitly convert data types as needed

## Preventing Logic Simplification

Sometimes you need to prevent the compiler from optimizing away certain components. This can be done using synthesis attributes like the "keep" attribute:

```vhdl
SIGNAL a, b, c: BIT;
ATTRIBUTE keep: BOOLEAN;
ATTRIBUTE keep OF a, b, c: SIGNAL IS TRUE;
```

This tells the compiler to preserve specific nodes during optimization.

## VHDL 2008 Additions

VHDL 2008 introduced several enhancements to concurrent code:

- WHEN and SELECT can now be used in sequential code
- WHEN allows boolean tests
- The SELECT? statement was introduced, allowing don't care inputs
- IF-GENERATE can use ELSIF/ELSE
- A new CASE-GENERATE form was added

## Important Note About Concurrent Code

Remember that in concurrent code, the order of statements doesn't matter. For example, if a code has three concurrent statements (stat1, stat2, stat3), these sequences would produce the same physical circuit:

```
{stat1;stat2;stat3} = {stat3;stat2;stat1} = {stat1;stat3;stat2}
```

This is a fundamental difference from sequential code.

## Conclusion

Concurrent code is a powerful feature of VHDL that enables parallel operations, making it ideal for designing combinational circuits. By understanding and correctly using the WHEN, SELECT, and GENERATE statements along with operators, you can efficiently design a wide range of digital circuits.

While concurrent code is primarily for combinational circuits, it's possible to create sequential circuits with concurrent code as well, though sequential code is usually more appropriate for that purpose.

As you grow more familiar with VHDL, you'll develop an intuition for when to use concurrent versus sequential code, enhancing your ability to create efficient digital designs.