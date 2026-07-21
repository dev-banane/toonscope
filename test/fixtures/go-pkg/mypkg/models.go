package mypkg

import "fmt"

// Point represents a 2D coordinate.
type Point struct {
	X int
	Y int
}

// Shape describes anything with an area.
type Shape interface {
	Area() float64
}

// NewPoint creates a Point.
func NewPoint(x int, y int) Point {
	return Point{X: x, Y: y}
}

// Move shifts the point by dx, dy.
func (p *Point) Move(dx int, dy int) {
	p.X += dx
	p.Y += dy
}

func unexportedHelper() int {
	return 1
}

var _ = fmt.Sprintf
