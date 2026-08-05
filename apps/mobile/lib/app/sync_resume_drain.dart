// The app-lifecycle drain trigger for the offline queue (B-262).
//
// sync_processor.dart's level-(a) policy doc lists three triggers: after an enqueue,
// on **screen-mount / app-resume**, and from a manual retry affordance. Only the
// first and third existed — there was no WidgetsBindingObserver anywhere in lib/, so
// a write queued while offline sat there until the user happened to reopen the exact
// screen that enqueued it and tap again.
//
// This widget supplies the missing trigger. It owns NO policy: it just calls
// [SyncProcessor.drainOnce] on mount and on every return to the foreground. What a
// drain then does — FIFO by createdAt, 2xx remove, 4xx dead-letter and continue, 5xx
// defer and stop, one drain at a time — is unchanged and still lives entirely in
// QueueDrainProcessor.
import 'package:flutter/widgets.dart';

import '../offline/sync_processor.dart';

/// Drains [processor] when the app mounts and whenever it returns to the foreground.
///
/// Wrap the app's home with it once (see main.dart). It renders [child] untouched —
/// it adds a lifecycle listener, not a layer of UI.
class SyncResumeDrain extends StatefulWidget {
  const SyncResumeDrain({
    super.key,
    required this.processor,
    required this.child,
  });

  /// The app-wide processor from `AppServices.syncProcessor`.
  final SyncProcessor processor;

  final Widget child;

  @override
  State<SyncResumeDrain> createState() => _SyncResumeDrainState();
}

class _SyncResumeDrainState extends State<SyncResumeDrain>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // On-mount trigger: replays anything left over from the previous run — which is
    // the whole point of the durable queue (sync_queue_store.dart).
    _drain();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    // Only the return to the foreground. `paused`/`inactive`/`detached`/`hidden`
    // are backgrounding transitions — draining there would fire a request the OS is
    // about to suspend.
    if (state == AppLifecycleState.resumed) {
      _drain();
    }
  }

  void _drain() {
    // Fire-and-forget: a lifecycle callback cannot await. A failed replay is not an
    // error to surface here — the (a) policy already keeps the op queued (5xx/
    // transport) or dead-letters it (4xx), and the screens render those states. This
    // catch only stops an unexpected store-level throw (e.g. a corrupt database)
    // from escaping as an unhandled async error and killing the app; the op stays
    // queued and the next trigger retries it.
    widget.processor.drainOnce().catchError((Object _) {});
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
