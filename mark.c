#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/types.h>
#include <sys/stat.h>

int main(int argc, char *argv[]) {
    const char *markPath = "/opt/mark/mark";

    // Verifica se il file esiste ed è eseguibile in /opt/mark/mark o /opt/mark/Mark
    if (access(markPath, X_OK) != 0) {
        if (access("/opt/mark/Mark", X_OK) == 0) {
            markPath = "/opt/mark/Mark";
        } else {
            fprintf(stderr, "Errore: applicazione Mark non trovata o non eseguibile in /opt/mark/mark\n");
            return 1;
        }
    }

    // Modalità debug opzionale con --debug, --verbose o variabile d'ambiente MARK_DEBUG
    int debug = 0;
    if (getenv("MARK_DEBUG") != NULL) {
        debug = 1;
    }
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--debug") == 0 || strcmp(argv[i], "--verbose") == 0) {
            debug = 1;
            break;
        }
    }

    // Se debug è attivo, esegui in primo piano senza silenziare i log
    if (debug) {
        char **args = malloc((argc + 1) * sizeof(char *));
        if (!args) {
            return 1;
        }
        args[0] = (char *)markPath;
        for (int i = 1; i < argc; i++) {
            args[i] = argv[i];
        }
        args[argc] = NULL;
        execv(args[0], args);
        perror("execv fallita");
        free(args);
        return 1;
    }

    // Fork per eseguire il processo in background e liberare subito il terminale
    pid_t pid = fork();
    if (pid < 0) {
        perror("fork fallita");
        return 1;
    }

    if (pid > 0) {
        // Il processo genitore termina immediatamente
        // Il terminale torna subito disponibile per altri comandi
        return 0;
    }

    // Processo figlio: crea una nuova sessione per staccarsi dal terminale
    if (setsid() < 0) {
        // Ignora eventuale errore setsid se già leader
    }

    // Reindirizza stdin, stdout e stderr a /dev/null per evitare che i log sporchino il terminale
    int devnull = open("/dev/null", O_RDWR);
    if (devnull >= 0) {
        dup2(devnull, STDIN_FILENO);
        dup2(devnull, STDOUT_FILENO);
        dup2(devnull, STDERR_FILENO);
        if (devnull > 2) {
            close(devnull);
        }
    }

    // Prepara gli argomenti per l'applicazione (/opt/mark/mark [argomenti...])
    char **args = malloc((argc + 1) * sizeof(char *));
    if (!args) {
        return 1;
    }

    args[0] = (char *)markPath;
    for (int i = 1; i < argc; i++) {
        args[i] = argv[i];
    }
    args[argc] = NULL;

    execv(args[0], args);

    // Se execv fallisce
    free(args);
    return 1;
}
