ctl-opt dftactgrp(*no);

dcl-f ORDERS usage(*input) keyed;
dcl-f CUSTOMER disk;

/copy QRPGLESRC,ORDCOPY

dcl-proc main;
  call INVPGM;
  callp ProcessOrder();

  exec sql
    select ORDER_ID, CUSTOMER_ID
      from MYLIB/ORDERS
      join CUSTOMER
        on CUSTOMER.CUSTOMER_ID = ORDERS.CUSTOMER_ID;
end-proc;
