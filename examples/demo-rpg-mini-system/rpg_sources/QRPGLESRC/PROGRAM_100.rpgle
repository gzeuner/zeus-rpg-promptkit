**FREE
ctl-opt dftactgrp(*no);

dcl-f FILE_100 disk keyed usage(*input);

dcl-proc MAIN;
  call PROGRAM_200;
  call PROGRAM_300;
end-proc;

