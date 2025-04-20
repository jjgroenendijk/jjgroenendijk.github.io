# Understanding VHDL Functions and Procedures: A Simple Guide

VHDL is a hardware description language used to design digital circuits. Today we'll explore two key elements of VHDL: functions and procedures. These are building blocks that help make your code more organized and reusable.

## What Are Subprograms in VHDL?

Functions and procedures are called "subprograms" in VHDL. They are similar to processes because they run in sequence (one step after another). Unlike regular VHDL code that runs in parallel, subprograms work more like traditional computer programs.

You can place subprograms in several locations:
- Inside a package (most common)
- Inside an entity
- Inside an architecture
- Inside a process

Packages are the most popular place for subprograms. This is how VHDL libraries are built.

## The ASSERT Statement

Before diving into functions and procedures, let's look at the ASSERT statement. It's a helpful tool for checking conditions in your code.

The ASSERT statement checks if a condition is true. If the condition is false, it prints a message. You can use it like this:

```vhdl
ASSERT (a'LENGTH=b'LENGTH)
REPORT "Signals a and b do not have the same length!"
SEVERITY FAILURE;
```

The severity level can be:
- NOTE: just passing information
- WARNING: something unusual happened
- ERROR: something serious happened
- FAILURE: something completely unacceptable happened

The compiler usually stops when ERROR or FAILURE occurs.

## VHDL Functions

A function is a piece of code that takes inputs and returns one value. Functions are great for operations you use often, like data conversions or math operations.

Here's what a function looks like:

```vhdl
FUNCTION max (in1, in2, in3: INTEGER) RETURN INTEGER IS
BEGIN
  IF (in1>=in2 AND in1>=in3) THEN
    RETURN in1;
  ELSIF (in2>=in1 AND in2>=in3) THEN
    RETURN in2;
  ELSE
    RETURN in3;
  END IF;
END FUNCTION;
```

This function takes three integers and returns the largest one.

Functions can only return one value. All parameters are inputs (mode IN). You can use functions in expressions like:

```vhdl
y <= max(a, b, c);
```

Functions can be "pure" or "impure":
- Pure functions only change their own variables (default)
- Impure functions can change signals outside the function

## VHDL Procedures

Procedures are similar to functions but with one big difference. They can have multiple outputs.

Here's an example of a procedure:

```vhdl
PROCEDURE min_max (SIGNAL a, b, c: IN INTEGER;
                   SIGNAL min, max: OUT INTEGER) IS
BEGIN
  IF (a>=b) THEN
    IF (a>=c) THEN max <= a;
      IF (b>=c) THEN min <= c;
      ELSE min <= b;
      END IF;
    ELSE
      max <= c;
      min <= b;
    END IF;
  -- more code here...
END PROCEDURE;
```

This procedure finds both the smallest and largest values among three inputs.

Unlike functions, procedure calls are statements on their own:

```vhdl
min_max(a, b, c, min, max);
```

Procedures allow parameters with different modes:
- IN: input parameters (default is CONSTANT)
- OUT: output parameters (default is VARIABLE)
- INOUT: both input and output (default is VARIABLE)

## Parameter Mapping

When calling functions or procedures, you can map parameters in two ways:

1. Positional mapping - parameters match by position:
```vhdl
y <= my_function(x1, x2);
```

2. Nominal mapping - parameters match by name:
```vhdl
y <= my_function(a=>x1, b=>x2);
```

## Overloading Operators

VHDL allows you to "overload" operators. This means you can define multiple versions of the same function for different data types.

For example, the "+" operator might have many versions:
- Adding two UNSIGNED numbers
- Adding a SIGNED number and an INTEGER
- Adding two STD_LOGIC_VECTOR values

The compiler picks the right version based on the data types you use.

## VHDL 2008 Improvements

VHDL 2008 added some nice features for functions and procedures:

1. The TO_STRING function makes it easier to convert values to strings
2. Functions and procedures can now have GENERIC parameters
3. Procedures can read OUT mode parameters internally
4. WHEN and SELECT statements can be used in sequential code

## Summary

Functions and procedures help make VHDL code more organized and reusable. Functions return a single value and are used in expressions. Procedures can have multiple outputs and are used as standalone statements.

The ASSERT statement helps check conditions in your code. It's especially useful for verifying function inputs.

By using these tools, you can create more structured and maintainable VHDL designs.