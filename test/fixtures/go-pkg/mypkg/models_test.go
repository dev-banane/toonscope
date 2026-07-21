package mypkg

import "testing"

func TestNewPoint(t *testing.T) {
	p := NewPoint(1, 2)
	if p.X != 1 {
		t.Fatal("bad x")
	}
}
