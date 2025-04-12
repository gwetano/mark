#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
    if (argc < 2) {
        int ret = system("/opt/mark/mark");
    return ret;
    }

    const char *file = argv[1];

    const char *markPath = "/opt/mark/mark"; 

    char command[1024];
    snprintf(command, sizeof(command), "\"%s\" \"%s\"", markPath, file);

    int ret = system(command);
    return ret;
}

