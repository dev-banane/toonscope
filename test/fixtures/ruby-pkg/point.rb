require 'json'
require_relative './helper'

# Adds two numbers together.
def add(a, b)
  a + b
end

class Point
  attr_accessor :x, :y

  # Creates a new point.
  def initialize(x, y)
    @x = x
    @y = y
  end

  def sum
    @x + @y
  end
end

module Greetable
  def greet
    'hi'
  end
end
