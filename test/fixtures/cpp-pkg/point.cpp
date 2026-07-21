#include "point.hpp"

namespace geom {

Point::Point(int x, int y) {
}

int Point::sum() {
    return x + y;
}

// distance computes the taxicab distance between two points.
int distance(Point a, Point b) {
    return (a.x - b.x) + (a.y - b.y);
}

}
