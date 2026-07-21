#pragma once
#include <string>

namespace geom {

// Point is a 2D coordinate with basic operations.
class Point {
public:
    int x;
    int y;
    Point(int x, int y);
    int sum();
};

}
