// Host regression test for the same child-handle registry compiled into Android.
// cc -D_GNU_SOURCE -I$JAVA_HOME/include -I$JAVA_HOME/include/linux -pthread terminal-pty-test.c -o /tmp/terminal-pty-test
#include "terminal-pty.c"
#include <assert.h>
static jint fixture(pid_t *pid) {
  pthread_mutex_lock(&children_lock);
  struct child_entry *entry = reserve_child();
  assert(entry);
  *pid = fork();
  assert(*pid >= 0);
  if (*pid == 0) { for (;;) pause(); }
  entry->pid = *pid;
  jint handle = entry->handle;
  pthread_mutex_unlock(&children_lock);
  return handle;
}
int main(void) {
  pid_t first_pid, second_pid;
  jint first = fixture(&first_pid);
  Java_com_bobmobile_BobTerminalPty_stop(NULL, NULL, first);
  Java_com_bobmobile_BobTerminalPty_waitFor(NULL, NULL, first);
  assert(lookup(first) == NULL);
  jint second = fixture(&second_pid);
  assert(first != second);
  // The slot can be reused, but its stale opaque handle cannot target this child.
  Java_com_bobmobile_BobTerminalPty_stop(NULL, NULL, first);
  assert(waitpid(second_pid, NULL, WNOHANG) == 0);
  assert(Java_com_bobmobile_BobTerminalPty_waitFor(NULL, NULL, first) == -1);
  Java_com_bobmobile_BobTerminalPty_stop(NULL, NULL, second);
  Java_com_bobmobile_BobTerminalPty_waitFor(NULL, NULL, second);
  assert(lookup(second) == NULL);
  pthread_mutex_lock(&children_lock);
  next_handle = INT_MAX;
  assert(reserve_child() == NULL);
  pthread_mutex_unlock(&children_lock);
  puts("opaque child handles: stale stop, stale wait, slot reuse and exhaustion passed");
  return 0;
}
