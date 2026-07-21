#include <stdio.h>
#include "point.h"

// Color describes an RGB channel selector.
enum Color { RED, GREEN, BLUE };

// add_points sums two points.
struct Point add_points(struct Point a, struct Point b) {
    struct Point result;
    result.x = a.x + b.x;
    result.y = a.y + b.y;
    return result;
}

static int private_helper(int n) {
    return n * 2;
}
