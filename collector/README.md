# Wardbook Collector

Run `setup.ps1` once to sign in, verify the passphrase against `wb_meta/crypto`, and save the DPAPI-protected collector state to `%APPDATA%\wardbook\collector.dat`.

Run `collect.ps1` to refresh the Firebase token, pull unconsumed `wb_outbox` batches, append unseen seeds into the inbox file, update the stats log, and then mark each batch consumed.

Run `register-task.ps1` to create a daily Windows scheduled task at `21:30`.
