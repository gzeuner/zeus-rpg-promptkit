**FREE
dcl-s STMT_001 varchar(500);
dcl-f TABLE_001 keyed usage(*update);

dcl-proc MAINPROC;
  exec sql
    select COLUMN_001
      from TABLE_001;

  exec sql
    prepare S1 from :STMT_001;
end-proc;
