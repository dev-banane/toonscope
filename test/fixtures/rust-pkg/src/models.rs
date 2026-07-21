use crate::utils::helper;
use std::collections::HashMap;

/// A 2D point.
pub struct Point {
    pub x: i32,
    pub y: i32,
}

/// Something with an area.
pub trait Shape {
    fn area(&self) -> f64;
}

pub enum Color {
    Red,
    Green,
    Blue,
}

impl Point {
    /// Creates a new point.
    pub fn new(x: i32, y: i32) -> Point {
        Point { x, y }
    }

    pub fn sum(&self) -> i32 {
        self.x + self.y
    }
}

/// Adds two points together.
pub fn add_points(a: Point, b: Point) -> Point {
    Point::new(a.x + b.x, a.y + b.y)
}

fn private_helper() -> i32 {
    helper();
    0
}
