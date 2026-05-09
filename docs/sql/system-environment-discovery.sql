-- PROJECT environment discovery queries
-- Purpose:
--   1. Confirm source-file presence in BIB, APPLIB, ASE
--   2. Inspect application files in APPDATA, APPLIB, ASE
--   3. Discover schema, columns, and likely ticket-relevant fields
-- Usage:
--   Replace the placeholder literals before execution.

-- 1) Source file inventory across the known development libraries.
SELECT TABLE_SCHEMA,
       TABLE_NAME,
       TABLE_TYPE,
       SYSTEM_TABLE_SCHEMA,
       SYSTEM_TABLE_NAME
FROM QSYS2.SYSTABLES
WHERE TABLE_SCHEMA IN ('BIB', 'APPLIB', 'ASE')
  AND TABLE_NAME IN (
    'QRPGLESRC',
    'QCPYSRC',
    'QCLSRC',
    'QCLLESRC',
    'QSQLSRC',
    'QSRVSRC',
    'QDDSSRC'
  )
ORDER BY TABLE_SCHEMA, TABLE_NAME;

-- 2) Application file inventory in the business-data libraries.
--    This helps confirm where physical and logical files exist.
SELECT TABLE_SCHEMA,
       TABLE_NAME,
       TABLE_TYPE,
       SYSTEM_TABLE_SCHEMA,
       SYSTEM_TABLE_NAME
FROM QSYS2.SYSTABLES
WHERE TABLE_SCHEMA IN ('APPDATA', 'APPLIB', 'ASE')
  AND TABLE_NAME NOT IN (
    'QRPGLESRC',
    'QCPYSRC',
    'QCLSRC',
    'QCLLESRC',
    'QSQLSRC',
    'QSRVSRC',
    'QDDSSRC'
  )
ORDER BY TABLE_SCHEMA, TABLE_NAME;

-- 3) Locate a concrete file or table across APPDATA, APPLIB, ASE.
--    Replace 'MEINTABLE' with the object you are investigating.
SELECT TABLE_SCHEMA,
       TABLE_NAME,
       TABLE_TYPE,
       SYSTEM_TABLE_SCHEMA,
       SYSTEM_TABLE_NAME
FROM QSYS2.SYSTABLES
WHERE TABLE_NAME = 'MEINTABLE'
  AND TABLE_SCHEMA IN ('APPDATA', 'APPLIB', 'ASE')
ORDER BY TABLE_SCHEMA, TABLE_NAME;

-- 4) Column shape for one concrete table or file.
--    Replace APPDATA/MEINTABLE as needed.
SELECT TABLE_SCHEMA,
       TABLE_NAME,
       ORDINAL_POSITION,
       COLUMN_NAME,
       DATA_TYPE,
       LENGTH,
       NUMERIC_SCALE,
       IS_NULLABLE,
       COLUMN_TEXT,
       COLUMN_HEADING
FROM QSYS2.SYSCOLUMNS
WHERE TABLE_SCHEMA = 'APPDATA'
  AND TABLE_NAME = 'MEINTABLE'
ORDER BY ORDINAL_POSITION;

-- 5) Search for likely ticket-relevant fields in the known business libraries.
SELECT TABLE_SCHEMA,
       TABLE_NAME,
       COLUMN_NAME,
       DATA_TYPE,
       LENGTH,
       COLUMN_TEXT
FROM QSYS2.SYSCOLUMNS
WHERE TABLE_SCHEMA IN ('APPDATA', 'APPLIB', 'ASE')
  AND (
    COLUMN_NAME LIKE '%STATUS%'
    OR COLUMN_NAME LIKE '%NR%'
    OR COLUMN_NAME LIKE '%DATUM%'
    OR COLUMN_NAME LIKE '%USER%'
    OR COLUMN_NAME LIKE '%TIME%'
    OR COLUMN_NAME LIKE '%ID%'
  )
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;

-- 6) Source file object statistics.
--    Change OBJECT_NAME to QRPGLESRC, QDDSSRC, QSQLSRC, ... as needed.
SELECT OBJLIB,
       OBJNAME,
       OBJTYPE,
       OBJATTRIBUTE,
       OBJTEXT,
       OBJOWNER
FROM TABLE(
  QSYS2.OBJECT_STATISTICS(
    OBJECT_SCHEMA => '*ALLUSR',
    OBJECT_NAME => 'QRPGLESRC',
    OBJECT_TYPE_LIST => '*FILE'
  )
)
WHERE OBJLIB IN ('BIB', 'APPLIB', 'ASE')
ORDER BY OBJLIB, OBJNAME;

-- 7) Program object lookup across the known libraries.
--    Replace MYPGM with the program under investigation.
SELECT OBJLIB,
       OBJNAME,
       OBJLONGNAME,
       OBJTYPE,
       OBJATTRIBUTE,
       OBJTEXT,
       OBJOWNER
FROM TABLE(
  QSYS2.OBJECT_STATISTICS(
    OBJECT_SCHEMA => '*ALLUSR',
    OBJECT_NAME => 'MYPGM',
    OBJECT_TYPE_LIST => '*PGM'
  )
)
WHERE OBJLIB IN ('BIB', 'APPLIB', 'ASE')
ORDER BY OBJLIB, OBJNAME;

-- 8) Quick schema discovery when only the table name is known.
--    Replace MEINTABLE with the physical/logical file or SQL table name.
SELECT TABLE_SCHEMA,
       TABLE_NAME
FROM QSYS2.SYSTABLES
WHERE TABLE_NAME = 'MEINTABLE'
ORDER BY TABLE_SCHEMA, TABLE_NAME;