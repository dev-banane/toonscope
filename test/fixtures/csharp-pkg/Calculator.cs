using System;
using System.Collections.Generic;

namespace MyApp
{
    /// Adds and manages numbers.
    public class Calculator
    {
        public int Add(int a, int b)
        {
            return a + b;
        }

        private int Secret()
        {
            return 0;
        }
    }

    public interface IShape
    {
        double Area();
    }

    public enum Color { Red, Green, Blue }
}
