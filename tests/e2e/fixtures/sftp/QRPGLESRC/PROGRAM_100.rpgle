**free
ctl-opt option(*srcstmt:*nodebugio);

dcl-s customerId packed(9:0);
dcl-s status char(1);

exec sql
  select CUSTOMER_ID, STATUS
    into :customerId, :status
    from DATA_EXAMPLE.CUSTOMERS
   where CUSTOMER_ID = :customerId;

*inlr = *on;
