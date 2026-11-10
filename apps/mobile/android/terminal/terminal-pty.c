// Bob's original PTY/process adapter. No Mosh or Termux code is linked here.
#include <jni.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <pthread.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

// Opaque, never-reused handles, not PIDs, cross the JNI boundary. A reaped
// child invalidates its slot under the same lock used for signalling. Keeping
// an exited child unreaped pins its PID until that invalidation is complete.
#define MAX_CHILDREN 16
struct child_entry { jint handle; pid_t pid; };
static struct child_entry children[MAX_CHILDREN];
static pthread_mutex_t children_lock = PTHREAD_MUTEX_INITIALIZER;
static jint next_handle = 1;
static struct child_entry *lookup(jint handle) {
  for (int i = 0; i < MAX_CHILDREN; ++i)
    if (children[i].handle == handle && handle > 0) return &children[i];
  return NULL;
}
static struct child_entry *reserve_child(void) {
  if (next_handle == INT_MAX) return NULL; // Never wrap and reuse a stale handle.
  for (int i = 0; i < MAX_CHILDREN; ++i) if (children[i].handle == 0) {
    children[i].handle = next_handle++;
    children[i].pid = -1;
    return &children[i];
  }
  return NULL;
}

JNIEXPORT jintArray JNICALL Java_com_bobmobile_BobTerminalPty_spawn(JNIEnv *env, jobject self,
    jstring executable, jstring host, jint port, jstring key) {
  (void)self;
  const char *exe = (*env)->GetStringUTFChars(env, executable, NULL);
  if (!exe) return NULL;
  const char *ip = (*env)->GetStringUTFChars(env, host, NULL);
  if (!ip) { (*env)->ReleaseStringUTFChars(env, executable, exe); return NULL; }
  const char *secret = (*env)->GetStringUTFChars(env, key, NULL);
  if (!secret) { (*env)->ReleaseStringUTFChars(env, executable, exe); (*env)->ReleaseStringUTFChars(env, host, ip); return NULL; }
  char keyenv[128], portstr[12], slavepath[128];
  snprintf(keyenv, sizeof(keyenv), "MOSH_KEY=%s", secret);
  snprintf(portstr, sizeof(portstr), "%d", port);
  char *argv[] = {(char *)exe, (char *)ip, portstr, NULL};
  char *childenv[] = {keyenv, "TERM=xterm-256color", "LANG=en_US.UTF-8", "LC_ALL=en_US.UTF-8",
    "PATH=/system/bin", "MOSH_PREDICTION_DISPLAY=adaptive", NULL};
  int master = posix_openpt(O_RDWR | O_NOCTTY | O_CLOEXEC), slave = -1;
  pid_t pid = -1;
  jint handle = -1;
  if (master >= 0 && grantpt(master) == 0 && unlockpt(master) == 0 &&
      ptsname_r(master, slavepath, sizeof(slavepath)) == 0) {
    slave = open(slavepath, O_RDWR | O_NOCTTY | O_CLOEXEC);
    if (slave >= 0) {
      struct winsize size = {.ws_row = 24, .ws_col = 80};
      ioctl(slave, TIOCSWINSZ, &size);
      pthread_mutex_lock(&children_lock);
      struct child_entry *entry = reserve_child();
      if (entry) {
        pid = fork();
        if (pid == 0) {
          // Only async-signal-safe operations before exec in the multithreaded app.
          setsid();
          ioctl(slave, TIOCSCTTY, 0);
          dup2(slave, STDIN_FILENO); dup2(slave, STDOUT_FILENO); dup2(slave, STDERR_FILENO);
#ifdef __NR_close_range
          if (syscall(__NR_close_range, 3u, ~0u, 0) < 0)
#endif
            for (int fd = 3; fd < 65536; ++fd) close(fd);
          execve(exe, argv, childenv);
          static const char failure[] = "Mosh executable could not start.\r\n";
          write(STDERR_FILENO, failure, sizeof(failure) - 1);
          _exit(127);
        }
        if (pid > 0) { entry->pid = pid; handle = entry->handle; }
        else { entry->pid = 0; entry->handle = 0; }
      }
      pthread_mutex_unlock(&children_lock);
    }
  }
  if (slave >= 0) close(slave);
  (*env)->ReleaseStringUTFChars(env, executable, exe);
  (*env)->ReleaseStringUTFChars(env, host, ip);
  (*env)->ReleaseStringUTFChars(env, key, secret);
  for (volatile char *p = keyenv; p < keyenv + sizeof(keyenv); ++p) *p = 0;
  jint values[2] = {handle, master};
  if (pid < 0) { if (master >= 0) close(master); values[1] = -1; }
  jintArray result = (*env)->NewIntArray(env, 2);
  if (result) (*env)->SetIntArrayRegion(env, result, 0, 2, values);
  else if (pid > 0) {
    pthread_mutex_lock(&children_lock);
    struct child_entry *entry = lookup(handle);
    if (entry) { kill(pid, SIGKILL); while (waitpid(pid, NULL, 0) < 0 && errno == EINTR) {} entry->handle = 0; entry->pid = 0; }
    pthread_mutex_unlock(&children_lock);
    close(master);
  }
  return result;
}
JNIEXPORT void JNICALL Java_com_bobmobile_BobTerminalPty_resize(JNIEnv *env, jobject self, jint fd, jint cols, jint rows) {
  (void)env; (void)self;
  struct winsize size = {.ws_row = (unsigned short)rows, .ws_col = (unsigned short)cols};
  ioctl(fd, TIOCSWINSZ, &size);
}
JNIEXPORT void JNICALL Java_com_bobmobile_BobTerminalPty_stop(JNIEnv *env, jobject self, jint handle) {
  (void)env; (void)self;
  pthread_mutex_lock(&children_lock);
  struct child_entry *entry = lookup(handle);
  if (entry) {
    int status;
    pid_t result = waitpid(entry->pid, &status, WNOHANG);
    if (result == 0) { kill(-entry->pid, SIGKILL); kill(entry->pid, SIGKILL); }
    else if (result > 0 || (result < 0 && errno == ECHILD)) { entry->handle = 0; entry->pid = 0; }
  }
  pthread_mutex_unlock(&children_lock);
}
JNIEXPORT jint JNICALL Java_com_bobmobile_BobTerminalPty_waitFor(JNIEnv *env, jobject self, jint handle) {
  (void)env; (void)self;
  for (;;) {
    pthread_mutex_lock(&children_lock);
    struct child_entry *entry = lookup(handle);
    if (!entry) { pthread_mutex_unlock(&children_lock); return -1; }
    int status = 0;
    pid_t result = waitpid(entry->pid, &status, WNOHANG);
    int error = errno;
    if (result > 0 || (result < 0 && error != EINTR)) { entry->handle = 0; entry->pid = 0; }
    pthread_mutex_unlock(&children_lock);
    if (result > 0) return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
    if (result < 0 && error != EINTR) return -1;
    usleep(20000);
  }
}
