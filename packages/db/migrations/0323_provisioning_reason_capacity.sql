-- There is no approval step: a wait an older provisioner left as `approval` is a wait for capacity, which every
-- release reads the same way.
UPDATE "machine_provisioning" SET "reason" = 'capacity' WHERE "reason" = 'approval';
