package com.example;

import java.util.List;
import java.util.Map;
import com.example.Helper;

/**
 * Adds and manages numbers.
 */
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }

    private int secret() {
        return 0;
    }
}

public interface Shape {
    double area();
}

public enum Color { RED, GREEN, BLUE }
