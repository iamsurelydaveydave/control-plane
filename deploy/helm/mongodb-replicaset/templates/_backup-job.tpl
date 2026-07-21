{{/*
On-demand backup Job template.
This is NOT deployed automatically - it's a template for the Control Plane API
to create Jobs when users trigger manual backups.

To use manually:
  kubectl create job --from=cronjob/<release>-backup <release>-backup-manual-$(date +%s) -n <namespace>
*/}}
